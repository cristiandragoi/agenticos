/**
 * projectController.ts — Authoritative project-level operational controller.
 *
 * Implements the PROJECT_OPERATE intent:
 *   - Resolves canonical project
 *   - Inspects current project state (goals, project tasks, background tasks, blockers)
 *   - Selects runnable, unblocked, not-yet-running work
 *   - Reuses existing running work where appropriate (deduplication)
 *   - Dispatches eligible work to appropriate workers (Revenue Operator, Hermes, CodeX)
 *   - Verifies workers/tasks actually entered running/queued state
 *   - Returns concise operational status speaking RESULTS without conversational filler
 */

import { projectsStore } from '../projectsStore.js';
import { projectTaskService } from './projectTaskService.js';
import { backgroundTaskManager } from '../backgroundTasks/manager.js';
import { backgroundTaskRepo } from '../backgroundTasks/store.js';
import { isExecutingStatus, type BackgroundTaskRecord } from '../backgroundTasks/types.js';
import { dispatchTask } from '../backgroundTasks/adapters.js';
import { logger } from '../../utils/logger.js';
import { bump } from '../../domains/jarvisNext/jarvisHealth.js';
import { evaluateExecutionGate, type ExecutionGateResult } from '../prerequisites/executionGate.js';
import { markActive as markGoalActive } from '../prerequisites/activeGoalRegistry.js';

/**
 * What kind of work — if any — was actually started by an OPERATE.
 *
 *   waiting_for_auth  → nothing started; an external prerequisite (a signed-in
 *                       FreeCash session) is missing. The ORIGINAL goal is
 *                       durably stored and resumes automatically.
 *   internal_planning → internal Revenue Operator planning only. No external
 *                       FreeCash action is happening or claimed.
 *   external_execution→ the real FreeCash executor is working against the live
 *                       account (a verified session exists).
 *   none              → nothing was started.
 */
export type ProjectWorkMode =
  | 'waiting_for_auth'
  | 'internal_planning'
  | 'external_execution'
  | 'none';

/** Service key declared in prerequisiteService.SERVICE_DEFINITIONS. */
const FREECASH_SERVICE_KEY = 'freecash';
const FREECASH_DEFAULT_GOAL = 'Start working on FreeCash';
const FREECASH_AUTH_BLOCK_TITLE = 'FreeCash: waiting for account sign-in';
const FREECASH_EXT_TASK_TITLE = 'FreeCash: external execution (verified session)';

export interface PresentedBlocker {
  taskId: string;
  title: string;
  reason: string;
  worker?: string;
  metadata?: Record<string, unknown>;
  dependencyIds?: string[];
  objective?: string;
  projectId?: string;
}

export interface BlockerDetailQueryOpts {
  conversationId: string;
  prompt: string;
  activeBlocker?: PresentedBlocker | null;
  lastPresentedBlockers?: PresentedBlocker[];
  projectId?: string;
}

export interface BlockerDetailResult {
  handled: boolean;
  spokenText: string;
  activeBlocker: PresentedBlocker | null;
  subIntent: 'which_task' | 'which_api' | 'why_blocked' | 'who_needs' | 'where_get' | 'general';
  detailFound: boolean;
  credentialProvider: string;
  dataSource: string;
}

export interface ProjectOperateResult {
  projectId: string;
  projectName: string;
  executed: boolean;
  verified: boolean;
  tasksStarted: string[];
  workerIds: string[];
  /** PHASE F: the worker/title of the task that is now active or queued (if any). */
  leadWorker?: string;
  leadTaskTitle?: string;
  executionIds: string[];
  runningCount: number;
  queuedCount: number;
  blockedCount: number;
  primaryBlocker?: string;
  /** ISO timestamp of the blocked-task record the primary blocker came from. */
  primaryBlockerRecordedAt?: string;
  spokenText: string;
  evidence: boolean;
  presentedBlockers?: PresentedBlocker[];
  /**
   * §Prerequisites: what actually happened. `waiting_for_auth` means NOTHING
   * was started because a live external session is required first.
   */
  workMode: ProjectWorkMode;
  /** True when the work is registered but deliberately not started. */
  waitingForAuth: boolean;
  /** Safe-for-speech description of the missing prerequisite. */
  authBlocker?: string | null;
  /** The user-facing action that clears the blocker. */
  authNextStep?: string | null;
  /** Durable goal row backing the work (survives restarts). */
  goalId?: string | null;
  /** The user's original goal, preserved verbatim. */
  originalGoal?: string | null;
  /** Tasks registered but NOT started (e.g. waiting_for_auth). */
  tasksRegistered: string[];
  /** Evidence artifact from a real external execution, when one ran. */
  externalEvidencePath?: string | null;
  /** True when this OPERATE was the automatic resume after authentication. */
  resumedFromAuth?: boolean;
  stateBefore: {
    runnable: number;
    running: number;
    queued: number;
    blocked: number;
  };
  stateAfter: {
    running: number;
    queued: number;
    blocked: number;
  };
}

export interface ProjectStopResult {
  projectId: string;
  projectName: string;
  executed: boolean;
  verified: boolean;
  tasksStopped: string[];
  spokenText: string;
}

export interface BlockerResolutionResult {
  projectId: string;
  projectName: string;
  blocker: string;
  requiresExternalCredentials: boolean;
  actionTaken: boolean;
  spokenText: string;
}

/**
 * Identify the primary human/external blocker from blocked tasks.
 *
 * The returned string carries the age of the source record: a blocker read from
 * a row that has not been revalidated in this turn must not be presented as
 * "the next blocker" as if it were freshly observed.
 */
function withBlockerAge(task: BackgroundTaskRecord, reason: string): string {
  const seen = (task as any).updatedAt || (task as any).createdAt;
  if (!seen) return reason;
  const at = new Date(seen);
  if (Number.isNaN(at.getTime())) return reason;
  const stamp = at.toISOString().slice(0, 10);
  const ageDays = Math.floor((Date.now() - at.getTime()) / 86_400_000);
  const age = ageDays >= 1 ? `, ${ageDays} day${ageDays === 1 ? '' : 's'} old` : '';
  return `${reason} (recorded ${stamp}${age}, not revalidated in this turn)`;
}

/**
 * Identify the primary human/external blocker from blocked tasks, with the
 * source record so callers can report its age truthfully.
 */
export function getPrimaryBlockerRecord(blockedTasks: BackgroundTaskRecord[]): { reason: string; recordedAt?: string } {
  const pick = (t: BackgroundTaskRecord, fallback: string) => ({
    reason: t.blocker || fallback,
    recordedAt: ((t as any).updatedAt || (t as any).createdAt) as string | undefined,
  });

  const credentialBlocker = blockedTasks.find((t) =>
    /\b(credential|credentials|api key|api keys|login|password|auth token|account)\b/i.test(t.blocker || '') ||
    /\b(credential|credentials|api key|api keys)\b/i.test(t.title || '')
  );
  if (credentialBlocker) return pick(credentialBlocker, 'external account credentials');

  const firstWithBlocker = blockedTasks.find((t) => t.blocker && !t.blocker.includes('Backend restarted'));
  if (firstWithBlocker?.blocker) return pick(firstWithBlocker, 'unresolved dependency');

  if (blockedTasks.length > 0) return pick(blockedTasks[0], 'unresolved dependency');

  return { reason: 'none' };
}

export function getPrimaryBlocker(blockedTasks: BackgroundTaskRecord[]): string {
  const rec = getPrimaryBlockerRecord(blockedTasks);
  if (rec.reason === 'none') return 'none';
  const match = blockedTasks.find((t) => (t.blocker || '') === rec.reason || !!(t.blocker && t.blocker === rec.reason));
  return match ? withBlockerAge(match, rec.reason) : rec.reason;
}

/**
 * Extract structured blockers for a project in prioritized order.
 */
export function extractProjectBlockers(projectId: string): PresentedBlocker[] {
  const bgTasks = backgroundTaskManager.listTasks({ projectId, limit: 50 });
  const blocked = bgTasks.filter((t) => t.status === 'blocked');
  const credentialBlockers = blocked.filter((t) =>
    /\b(credential|credentials|api key|api keys|login|password|auth token|account)\b/i.test(t.blocker || '') ||
    /\b(credential|credentials|api key|api keys)\b/i.test(t.title || '')
  );
  const otherBlockers = blocked.filter((t) => !credentialBlockers.includes(t));
  const sorted = [...credentialBlockers, ...otherBlockers];

  return sorted.map((t) => ({
    taskId: t.taskId,
    title: t.title,
    reason: t.blocker || 'Unspecified blocker',
    worker: t.worker || undefined,
    metadata: typeof t.metadata === 'object' && t.metadata !== null ? (t.metadata as Record<string, unknown>) : undefined,
    dependencyIds: Array.isArray((t as any).dependencyIds) ? (t as any).dependencyIds : undefined,
    objective: t.objective || undefined,
    projectId,
  }));
}

/**
 * Execute the first-class PROJECT_OPERATE command.
 */
export async function operateProject(opts: {
  projectId: string;
  conversationId?: string;
  continueOnly?: boolean;
  /** The user's ORIGINAL goal, preserved verbatim for the durable goal record. */
  originalGoal?: string;
  /**
   * True when this OPERATE is the automatic resume that runs AFTER a live
   * session verification cleared the authentication blocker. The original goal
   * — never a fresh "what would you like me to do?" — is executed.
   */
  resumeFromAuth?: boolean;
}): Promise<ProjectOperateResult> {
  const { projectId, conversationId, continueOnly = false } = opts;
  const originalGoal = (opts.originalGoal || '').trim() || FREECASH_DEFAULT_GOAL;
  const proj = projectsStore.getProject(projectId);
  if (!proj) {
    return {
      projectId,
      projectName: projectId,
      executed: false,
      verified: false,
      tasksStarted: [],
      tasksRegistered: [],
      workerIds: [],
      executionIds: [],
      runningCount: 0,
      queuedCount: 0,
      blockedCount: 0,
      workMode: 'none',
      waitingForAuth: false,
      spokenText: `I cannot find a project with ID ${projectId}.`,
      evidence: false,
      stateBefore: { runnable: 0, running: 0, queued: 0, blocked: 0 },
      stateAfter: { running: 0, queued: 0, blocked: 0 },
    };
  }

  // Ensure project is active and focused
  if (proj.status !== 'active') {
    projectsStore.updateProject(projectId, { status: 'active' });
  }
  projectsStore.setActiveProjectId(projectId);

  // 1. Inspect existing authoritative state BEFORE
  const existingBgTasks = backgroundTaskManager.listTasks({ projectId, limit: 100 });
  const runningBefore = existingBgTasks.filter((t) => isExecutingStatus(t.status));
  const queuedBefore = existingBgTasks.filter((t) => t.status === 'queued');
  const blockedBefore = existingBgTasks.filter((t) => t.status === 'blocked');
  const primaryBlocker = getPrimaryBlocker(blockedBefore);

  const stateBefore = {
    runnable: queuedBefore.length,
    running: runningBefore.length,
    queued: queuedBefore.length,
    blocked: blockedBefore.length,
  };

  logger.info('[ProjectController] OPERATE_ENTERED', {
    projectId,
    projectName: proj.name,
    continueOnly,
    stateBefore,
  });

  const tasksStarted: string[] = [];
  const tasksRegistered: string[] = [];
  const workerIds: string[] = [];
  const executionIds: string[] = [];

  // §Prerequisites: what this OPERATE actually did. Filled in by the gate
  // below; the speech and the renderer read ONLY these facts.
  let workMode: ProjectWorkMode = 'none';
  let waitingForAuth = false;
  let authBlocker: string | null = null;
  let authNextStep: string | null = null;
  let goalId: string | null = null;
  let externalEvidencePath: string | null = null;

  // Check global worker occupancy to respect concurrency limits
  const globalActive = backgroundTaskManager.listTasks({ activeOnly: true });
  const globalExecuting = globalActive.filter((t) => isExecutingStatus(t.status));
  const hermesBusy = globalExecuting.some((t) => t.worker === 'hermes');
  const revenueBusy = globalExecuting.some((t) => t.worker === 'revenue' || t.route === 'revenue_operator');

  // STEP A: Dispatch existing eligible queued background tasks for this project
  if (queuedBefore.length > 0) {
    // Deduplicate against identical tasks
    const seenTitles = new Set<string>();
    for (const qTask of queuedBefore) {
      if (seenTitles.has(qTask.title)) {
        continue; // deduplicate
      }
      seenTitles.add(qTask.title);

      if (qTask.worker === 'hermes' && hermesBusy) {
        // Hermes is at concurrency limit; keep task queued with position
        continue;
      }
      if ((qTask.worker === 'revenue' || qTask.route === 'revenue_operator') && revenueBusy) {
        continue;
      }

      // ── CROSS-PROJECT CLAIM GATE (P0) ───────────────────────────────────
      // A task may only ever be dispatched for the project this operation was
      // resolved for. If the store ever hands back a foreign task, refuse it
      // instead of starting another project's work.
      if (qTask.projectId !== projectId) {
        bump('cross_project_execution_blocked');
        logger.error('[ProjectController] CROSS_PROJECT_TASK_REJECTED', {
          requestedProjectId: projectId, taskId: qTask.taskId, taskProjectId: qTask.projectId, title: qTask.title,
        });
        continue;
      }

      // Dispatch this queued task
      try {
        const dispatchRes = await dispatchTask(qTask);
        if (dispatchRes.ok) {
          tasksStarted.push(qTask.taskId);
          workerIds.push(qTask.worker);
          const updated = backgroundTaskRepo.getTask(qTask.taskId);
          if (updated?.linkedRunId) {
            executionIds.push(updated.linkedRunId);
          }
        }
      } catch (err: any) {
        logger.warn(`[ProjectController] Failed to dispatch queued task ${qTask.taskId}:`, err);
      }
    }
  }

  // STEP B: Free Cash / revenue initiative.
  //
  // ── PREREQUISITE GATE ────────────────────────────────────────────────────
  // A FreeCash mission may only be dispatched when LIVE external evidence
  // proves an authenticated session. Without it, NOTHING is created as
  // executing: a `waiting_for_auth` record and a durable goal are written, and
  // the answer says plainly that no work has started. Creating an internal
  // task is not evidence of external execution (PHASE H).
  const isFreeCashOrRevenue =
    projectId === 'proj-free-cash' ||
    proj.revenueVertical === 'free_cash' ||
    /free\s*cash/i.test(proj.name);

  const existingRoActive = existingBgTasks.some(
    (t) =>
      (t.route === 'revenue_operator' || (t.metadata as any)?.capabilityId === 'revenue_operator') &&
      (isExecutingStatus(t.status) || t.status === 'queued')
  );

  let gate: ExecutionGateResult | null = null;

  if (isFreeCashOrRevenue && !continueOnly) {
    gate = evaluateExecutionGate({
      service: FREECASH_SERVICE_KEY,
      originalGoal,
      projectId,
      conversationId: conversationId ?? null,
    });
    goalId = gate.goal?.id ?? null;

    if (!gate.allowed) {
      // ── WAITING_FOR_AUTH ────────────────────────────────────────────────
      waitingForAuth = true;
      workMode = 'waiting_for_auth';
      authBlocker = gate.blocker;
      authNextStep = gate.nextStep;

      const alreadyWaiting = existingBgTasks.some(
        (t) => t.status === 'waiting_for_auth' || (t.metadata as any)?.waitingForAuth === true
      );
      if (!alreadyWaiting) {
        const blockedRes = backgroundTaskManager.createTask({
          title: FREECASH_AUTH_BLOCK_TITLE,
          objective: `Held at the authentication prerequisite: ${authBlocker}`,
          originalRequest: originalGoal,
          route: 'freecash_auth_gate',
          selectedAgent: 'Revenue Operator',
          worker: 'revenue',
          priority: 'high',
          projectId,
          conversationId,
          metadata: {
            waitingForAuth: true,
            service: FREECASH_SERVICE_KEY,
            obstacle: 'authentication',
            nextStep: authNextStep,
            goalId,
            capabilityId: 'revenue_operator',
            blockerKind: 'prerequisite_auth',
            source: 'projectController.operateProject',
            originalGoal,
          },
        });
        if (blockedRes.task && blockedRes.task.projectId === projectId) {
          // The task is REGISTERED, not started. `waiting_for_auth` is not an
          // executing status, so it can never be spoken as "running".
          backgroundTaskManager.transition(blockedRes.task.taskId, 'waiting_for_auth', {
            currentStage: 'waiting_for_auth',
            progressMessage: authBlocker ?? undefined,
            blocker: authBlocker,
            resumable: true,
          });
          backgroundTaskManager.appendEvent(
            blockedRes.task.taskId,
            'task.blocked',
            `Waiting for authentication — ${authBlocker}`,
            { waitingForAuth: true, service: FREECASH_SERVICE_KEY, goalId },
          );
          tasksRegistered.push(blockedRes.task.taskId);
        } else if (blockedRes.error) {
          logger.warn(`[ProjectController] Could not register waiting_for_auth task: ${blockedRes.error}`);
        }
      } else {
        const existingWait = existingBgTasks.find(
          (t) => t.status === 'waiting_for_auth' || (t.metadata as any)?.waitingForAuth === true
        );
        if (existingWait) tasksRegistered.push(existingWait.taskId);
      }
    } else {
      // ── PREREQUISITE SATISFIED ──────────────────────────────────────────
      // Internal Revenue Operator planning (a bounded internal mission) stays
      // SEPARATE from real FreeCash execution below.
      if (!existingRoActive) {
        const roTaskRes = backgroundTaskManager.createTask({
          title: 'Revenue Operator: Free Cash Mission',
          objective: 'Run bounded DEV revenue mission for Free Cash monetization workflow',
          originalRequest: 'Operate Free Cash',
          route: 'revenue_operator',
          selectedAgent: 'Revenue Operator',
          worker: 'revenue',
          priority: 'high',
          projectId,
          conversationId,
          metadata: {
            capabilityId: 'revenue_operator',
            target: 'Free Cash',
            vertical: 'free_cash',
            workMode: 'internal_planning',
            originalGoal,
            goalId,
            acceptanceCriteria: [
              'A Revenue Operator mission record exists for proj-free-cash and reaches a terminal state or a recorded blocker.',
              'Every dispatched step leaves evidence (linked run id, files changed, or an explicit failure reason).',
              'No success is reported for a step whose result was not verified.',
            ],
            constraints: [
              'Bounded runtime: the mission must not run unbounded.',
              'No credential-gated step may be started without credentials present.',
              'The authoritative project store remains the source of truth for project state.',
              'This mission is INTERNAL planning. It is not evidence of external FreeCash execution.',
            ],
            source: 'projectController.operateProject',
          },
        });

        if (roTaskRes.task) {
          if (roTaskRes.task.projectId !== projectId) {
            bump('cross_project_execution_blocked');
            logger.error('[ProjectController] CROSS_PROJECT_MISSION_REJECTED', {
              requestedProjectId: projectId, missionId: roTaskRes.task.taskId, missionProjectId: roTaskRes.task.projectId,
            });
          } else {
            tasksStarted.push(roTaskRes.task.taskId);
            workerIds.push('revenue');
            workMode = 'internal_planning';
            try {
              const dRes = await dispatchTask(roTaskRes.task);
              if (dRes.ok) {
                const updated = backgroundTaskRepo.getTask(roTaskRes.task.taskId);
                if (updated?.linkedRunId) {
                  executionIds.push(updated.linkedRunId);
                }
              if (updated && isExecutingStatus(updated.status)) workMode = 'internal_planning';
              } else {
                // Dispatch refused (e.g. the adapter re-checked the gate): the
                // task is not running, so nothing may be claimed.
                tasksStarted.pop();
                workMode = 'none';
              }
            } catch (err: any) {
              logger.warn(`[ProjectController] Failed to dispatch Revenue Operator task:`, err);
              tasksStarted.pop();
              workMode = 'none';
            }
          }
        }
      }

      // ── REAL EXTERNAL EXECUTION ─────────────────────────────────────────
      // Separately dispatched, and only ever after a live session check says
      // the account is authenticated. The adapter performs the real probe.
      const ext = await startFreeCashExternalExecution({
        projectId,
        conversationId,
        goalId,
        existing: existingBgTasks,
        continueOnly,
      });
      if (ext) {
        if (!ext.alreadyRunning) {
          tasksStarted.push(ext.taskId);
          workerIds.push('revenue');
        }
        // A live session is verified here, so this IS real external execution.
        workMode = 'external_execution';
        externalEvidencePath = ext.evidencePath;
      }

      // The blocker cleared for real: any waiting_for_auth record for this
      // project is resolved against live evidence, never silently deleted.
      resolveWaitingForAuthTasks(projectId, authBlocker ?? 'live session verified');

      // A resume that actually dispatched work stops being resume_pending, so
      // the startup pump cannot re-run it forever.
      if (gate.goal && gate.goal.status !== 'active' && tasksStarted.length > 0) {
        markGoalActive(gate.goal.id);
      }
    }
  }
  const resumedFromAuth = Boolean(opts.resumeFromAuth) && workMode !== 'waiting_for_auth';

  // STEP C: If this is Shopify or another project and no task has been started/running yet
  const isShopifyOrGeneric =
    projectId === 'proj-shopify' ||
    proj.revenueVertical === 'shopify' ||
    /shopify/i.test(proj.name);

  const existingProjectActive = existingBgTasks.some(
    (t) => t.projectId === projectId && (isExecutingStatus(t.status) || t.status === 'queued')
  );

  if (isShopifyOrGeneric && !existingProjectActive && !continueOnly && !waitingForAuth && tasksStarted.length === 0) {
    const shopifyTaskRes = backgroundTaskManager.createTask({
      title: 'Shopify: Storefront & Channel Operations',
      objective: 'Run Shopify channel verification, storefront inspection and product inventory sync',
      originalRequest: `Operate ${proj.name}`,
      route: 'project_operate',
      selectedAgent: 'Hermes',
      worker: 'hermes',
      priority: 'high',
      projectId,
      conversationId,
      metadata: {
        capabilityId: 'project_operations',
        target: proj.name,
        vertical: 'shopify',
        acceptanceCriteria: [
          'Shopify store configuration and channel connectivity verified.',
          'Execution leaves evidence in project task registry.',
        ],
        source: 'projectController.operateProject',
      },
    });

    if (shopifyTaskRes.task) {
      if (shopifyTaskRes.task.projectId === projectId) {
        tasksStarted.push(shopifyTaskRes.task.taskId);
        workerIds.push('hermes');
        try {
          const dRes = await dispatchTask(shopifyTaskRes.task);
          if (dRes.ok) {
            const updated = backgroundTaskRepo.getTask(shopifyTaskRes.task.taskId);
            if (updated?.linkedRunId) {
              executionIds.push(updated.linkedRunId);
            }
          }
        } catch (err: any) {
          logger.warn(`[ProjectController] Failed to dispatch Shopify task:`, err);
        }
      }
    }
  }

  // 2. Re-inspect authoritative state AFTER
  const afterTasks = backgroundTaskManager.listTasks({ projectId, limit: 100 });
  const runningAfter = afterTasks.filter((t) => isExecutingStatus(t.status));
  const queuedAfter = afterTasks.filter((t) => t.status === 'queued');
  const blockedAfter = afterTasks.filter((t) => t.status === 'blocked');
  const waitingAfter = afterTasks.filter((t) => t.status === 'waiting_for_auth');

  const stateAfter = {
    running: runningAfter.length,
    queued: queuedAfter.length,
    blocked: blockedAfter.length,
  };

  // Nothing may be claimed as started/executed while the gate holds.
  const executed = !waitingForAuth && (tasksStarted.length > 0 || runningAfter.length > 0);
  const verified = !waitingForAuth && (runningAfter.length > 0 || queuedAfter.length > 0);

  // 3. Formulate natural results-focused speech (NO CANNED FILLER)
  // ── CLAIM GATE (Phase F §10) ─────────────────────────────────────────
  // Only the AUTHORITATIVE post-state may produce a claim, and the claim names
  // the worker the task was actually assigned to. No task record ⇒ no claim.
  const { workerLabel } = await import('../../domains/jarvisNext/resultRenderer.js');
  const activeLead = runningAfter[0];
  const queuedLead = queuedAfter[0];
  let spokenText: string;
  if (waitingForAuth) {
    // Precondition unmet: say exactly that. No worker, no run, no claim.
    spokenText =
      `I have not started anything on ${proj.name} — ${authBlocker} ` +
      `${authNextStep} Your original goal is saved, so you will not have to repeat it.`;
  } else if (runningAfter.length > 0 && activeLead) {
    const label = workerLabel(activeLead.worker) || 'a worker';
    // Truth distinction: internal deviation-planning is NOT external execution.
    const modeNote = workMode === 'external_execution'
      ? ' That is the real FreeCash executor against the live account, with a verified session.'
      : workMode === 'internal_planning'
        ? ' That is internal revenue planning — it is not live FreeCash execution.'
        : '';
    spokenText =
      `I've assigned ${activeLead.title} to ${label} — ${runningAfter.length === 1 ? 'it is' : `${runningAfter.length} tasks are`} running now.${modeNote}` +
      (blockedAfter.length > 0 ? ` ${blockedAfter.length} item${blockedAfter.length === 1 ? ' is' : 's are'} still blocked by ${primaryBlocker}.` : '');
  } else if (queuedAfter.length > 0 && queuedLead) {
    const label = workerLabel(queuedLead.worker) || 'a worker';
    spokenText =
      `I've queued ${queuedAfter.length} ${proj.name} task${queuedAfter.length === 1 ? '' : 's'} for ${label} — ${queuedAfter.length === 1 ? 'it has' : 'they have'} not started yet.` +
      (blockedAfter.length > 0 ? ` ${blockedAfter.length} remain${blockedAfter.length === 1 ? 's' : ''} blocked by ${primaryBlocker}.` : '');
  } else if (blockedAfter.length > 0) {
    spokenText = `I checked ${proj.name}, but nothing is runnable right now — ${blockedAfter.length} item${blockedAfter.length === 1 ? ' is' : 's are'} blocked by ${primaryBlocker}. I haven't started a worker for it.`;
  } else {
    spokenText = `I checked ${proj.name}, but there isn't a runnable implementation task right now.`;
  }

  logger.info('[ProjectController] OPERATE_COMPLETED', {
    projectId,
    executed,
    verified,
    workMode,
    waitingForAuth,
    authBlocker,
    goalId,
    tasksStarted,
    tasksRegistered,
    workerIds,
    executionIds,
    stateBefore,
    stateAfter,
    spokenText,
  });

  // STRUCTURED RESULT → GUARDED NATURAL EXPRESSION. The mechanical text stays in
  // the log/trace; speech gets validated natural phrasing (facts unchanged).
  let naturalSpeech = spokenText;
  try {
    const { renderOperationalResult } = await import('../../domains/jarvisNext/resultRenderer.js');
    naturalSpeech = await renderOperationalResult({
      kind: 'project_operate',
      entityName: proj.name,
      // §Prerequisites: what actually happened, so the expression layer can
      // never turn internal planning or a held prerequisite into "running".
      workMode,
      authBlocker: authBlocker ?? undefined,
      authNextStep: authNextStep ?? undefined,
      originalGoal,
      resumedFromAuth,
      waitingForAuthTasks: waitingAfter.length,
      externalEvidencePath: externalEvidencePath ?? undefined,
      runningTasks: stateAfter.running,
      queuedTasks: stateAfter.queued,
      blockedTasks: stateAfter.blocked,
      blocker: stateAfter.blocked > 0 ? primaryBlocker : undefined,
      blockerRecordedAt: getPrimaryBlockerRecord(blockedAfter).recordedAt,
      blockerRevalidated: false,
      // PHASE F: the assignment facts, straight from the task record.
      worker: (runningAfter[0] || queuedAfter[0])?.worker,
      taskTitle: (runningAfter[0] || queuedAfter[0])?.title,
      success: executed || runningAfter.length > 0,
      verified,
    });
  } catch {
    /* keep the mechanical text if rendering is unavailable */
  }

  return {
    projectId,
    projectName: proj.name,
    leadWorker: (runningAfter[0] || queuedAfter[0])?.worker,
    leadTaskTitle: (runningAfter[0] || queuedAfter[0])?.title,
    executed,
    verified,
    workMode,
    waitingForAuth,
    authBlocker,
    authNextStep,
    goalId,
    originalGoal,
    tasksStarted,
    tasksRegistered,
    externalEvidencePath,
    resumedFromAuth,
    workerIds,
    executionIds,
    runningCount: stateAfter.running,
    queuedCount: stateAfter.queued,
    blockedCount: stateAfter.blocked,
    primaryBlocker,
    /** Age source for the blocker so callers can speak it truthfully. */
    primaryBlockerRecordedAt: getPrimaryBlockerRecord(blockedAfter).recordedAt,
    spokenText: naturalSpeech,
    evidence: true,
    presentedBlockers: extractProjectBlockers(projectId),
    stateBefore,
    stateAfter,
  };
}

/**
 * ── REAL FREECASH EXECUTION (a separate, honest path) ───────────────────────
 *
 * The internal Revenue Operator mission above is planning. This creates the
 * background task that drives the real FreeCash executor (headless Playwright
 * against the managed profile). The task is NOT marked running here — the
 * worker adapter performs the live session probe and only then transitions to
 * running. If the probe says the session is not authenticated, the task goes
 * to `waiting_for_auth` instead and no external claim is ever made.
 */
export async function startFreeCashExternalExecution(opts: {
  projectId: string;
  conversationId?: string;
  goalId?: string | null;
  existing?: BackgroundTaskRecord[];
  continueOnly?: boolean;
}): Promise<{ taskId: string; alreadyRunning: boolean; evidencePath: string | null } | null> {
  const { projectId, conversationId, goalId, continueOnly } = opts;
  const existing = opts.existing ?? backgroundTaskManager.listTasks({ projectId, limit: 100 });

  // Never start a second external execution while one is still live.
  const active = existing.find(
    (t) =>
      t.route === 'freecash_execution' &&
      (isExecutingStatus(t.status) || t.status === 'queued' || t.status === 'waiting_for_auth' || t.status === 'review')
  );
  if (active) {
    return {
      taskId: active.taskId,
      alreadyRunning: true,
      evidencePath: ((active.metadata as any)?.evidencePath as string) || null,
    };
  }

  // Evidence from a previous verified external run, reported truthfully.
  const lastVerified = existing
    .filter((t) => t.route === 'freecash_execution' && t.verificationState === 'passed')
    .sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || ''))[0];
  const priorEvidence = ((lastVerified?.metadata as any)?.evidencePath as string) || null;

  if (continueOnly) return null;

  const res = backgroundTaskManager.createTask({
    title: FREECASH_EXT_TASK_TITLE,
    objective:
      'Run the real FreeCash executor against the live account: verify the authenticated session, then perform a read-only inventory of available work. No withdrawals, no offers, no identity actions.',
    originalRequest: 'Operate FreeCash (external execution)',
    route: 'freecash_execution',
    selectedAgent: 'FreeCash Executor',
    worker: 'revenue',
    priority: 'high',
    projectId,
    conversationId,
    metadata: {
      service: FREECASH_SERVICE_KEY,
      workMode: 'external_execution',
      goalId: goalId ?? null,
      capabilityId: 'freecash_executor',
      acceptanceCriteria: [
        'A live FreeCash session probe was performed and its outcome recorded.',
        'External evidence (DOM observations + artifact path) exists for any claimed external work.',
        'No external action is claimed that the executor did not actually perform.',
      ],
      constraints: [
        'Read-only with respect to the external account: no withdrawals, offers, or identity actions.',
        'Credentials are never typed, read, or stored by AgenticOS.',
      ],
      source: 'projectController.startFreeCashExternalExecution',
    },
  });

  if (!res.task) {
    logger.warn(`[ProjectController] FreeCash external execution not started: ${res.error}`);
    return null;
  }
  if (res.task.projectId !== projectId) {
    bump('cross_project_execution_blocked');
    logger.error('[ProjectController] CROSS_PROJECT_EXT_EXECUTION_REJECTED', {
      requestedProjectId: projectId, taskId: res.task.taskId, taskProjectId: res.task.projectId,
    });
    return null;
  }

  try {
    await dispatchTask(res.task);
  } catch (err: any) {
    logger.warn(`[ProjectController] FreeCash external execution dispatch failed: ${err?.message}`);
  }
  return { taskId: res.task.taskId, alreadyRunning: false, evidencePath: priorEvidence };
}

/**
 * Resolve tasks that were held at the authentication prerequisite, now that
 * LIVE evidence says the session is authenticated. They are completed through
 * the canonical verification gate with an explicit note — never deleted, and
 * never completed while the blocker still stands.
 */
export function resolveWaitingForAuthTasks(projectId: string, note: string): string[] {
  const resolved: string[] = [];
  const held = backgroundTaskManager
    .listTasks({ projectId, limit: 50 })
    .filter((t) => t.status === 'waiting_for_auth');
  for (const t of held) {
    try {
      const updated = backgroundTaskManager.verifyCompletion(t.taskId, {
        resultText: `${t.title} — precondition satisfied: ${note}.`,
        readOnly: true,
        verificationNote: 'Prerequisite revalidated against live external session evidence.',
      });
      if (updated?.status === 'completed') resolved.push(t.taskId);
    } catch (err: any) {
      logger.warn(`[ProjectController] Could not resolve waiting_for_auth task ${t.taskId}: ${err?.message}`);
    }
  }
  return resolved;
}

/**
 * Stop/pause project-wide operations safely.
 */
export async function stopProject(opts: {
  projectId: string;
  conversationId?: string;
}): Promise<ProjectStopResult> {
  const { projectId } = opts;
  const proj = projectsStore.getProject(projectId);
  const projectName = proj?.name || projectId;

  const active = backgroundTaskManager.listTasks({ projectId, activeOnly: true });
  const tasksStopped: string[] = [];

  for (const t of active) {
    try {
      backgroundTaskManager.cancelTask(t.taskId, `Stopped by user — project ${projectName} operations paused.`);
      tasksStopped.push(t.taskId);
    } catch (err: any) {
      logger.warn(`[ProjectController] Failed to stop task ${t.taskId}:`, err);
    }
  }

  // Also stop Revenue Operator supervisor if applicable
  if (projectId === 'proj-free-cash') {
    try {
      const { revenueSupervisor } = await import('../revenueOperator/revenueSupervisor.js');
      revenueSupervisor.setControlState('STOP');
    } catch {}
  }

  const spokenText = tasksStopped.length > 0
    ? `Stopped. Halted ${tasksStopped.length} active ${projectName} ${tasksStopped.length === 1 ? 'task' : 'tasks'}.`
    : `Stopped. Nothing was actively running in ${projectName}.`;

  return {
    projectId,
    projectName,
    executed: true,
    verified: true,
    tasksStopped,
    spokenText,
  };
}

/**
 * Resolve the first or specified blocker from the structured blocker list.
 */
export async function resolveFirstBlocker(opts: {
  projectId: string;
  targetBlockerId?: string;
  conversationId?: string;
}): Promise<BlockerResolutionResult> {
  const { projectId, targetBlockerId } = opts;
  const proj = projectsStore.getProject(projectId);
  const projectName = proj?.name || projectId;

  const blocked = backgroundTaskManager.listTasks({ projectId, limit: 50 }).filter((t) => t.status === 'blocked');
  const targetTask = targetBlockerId
    ? (blocked.find((t) => t.taskId === targetBlockerId) || blocked[0])
    : blocked[0];

  const primaryBlocker = targetTask ? (targetTask.blocker || getPrimaryBlocker(blocked)) : getPrimaryBlocker(blocked);
  const taskTitle = targetTask ? targetTask.title : 'External Account Credential Setup';

  const isCredential =
    /\b(credential|credentials|api key|api keys|login|password|auth token|account)\b/i.test(primaryBlocker) ||
    /\b(credential|credentials|api key|api keys)\b/i.test(taskTitle);

  if (isCredential) {
    return {
      projectId,
      projectName,
      blocker: primaryBlocker,
      requiresExternalCredentials: true,
      actionTaken: false,
      spokenText: `The blocked task "${taskTitle}" requires external FreeCash API keys or account credentials. To resolve it, provide your credentials in settings or environment configuration.`,
    };
  }

  // If there's a resumable or retriable task
  const retryable = targetTask?.resumable || (targetTask?.metadata as any)?.recoveryAction === 'retry'
    ? targetTask
    : blocked.find((t) => t.resumable || (t.metadata as any)?.recoveryAction === 'retry');

  if (retryable) {
    backgroundTaskManager.transition(retryable.taskId, 'queued', { blocker: null, lastError: null });
    await backgroundTaskManager.pumpQueuedForWorker(retryable.worker);
    return {
      projectId,
      projectName,
      blocker: primaryBlocker,
      requiresExternalCredentials: false,
      actionTaken: true,
      spokenText: `Retrying task ${retryable.title} in ${projectName}.`,
    };
  }

  return {
    projectId,
    projectName,
    blocker: primaryBlocker,
    requiresExternalCredentials: false,
    actionTaken: false,
    spokenText: `The primary blocker in ${projectName} is: ${primaryBlocker}. It requires external resolution before work can continue.`,
  };
}

/**
 * Query authoritative details for an active or specified blocker.
 */
export async function queryBlockerDetail(opts: BlockerDetailQueryOpts): Promise<BlockerDetailResult> {
  const { conversationId, prompt, activeBlocker, lastPresentedBlockers, projectId = 'proj-free-cash' } = opts;
  const lower = prompt.toLowerCase();

  // 1. Resolve target blocker: check ordinal or active blocker or project blockers
  let target: PresentedBlocker | null = null;
  if (lastPresentedBlockers && lastPresentedBlockers.length > 0) {
    if (/\b(?:first|1st)\b/i.test(lower)) {
      target = lastPresentedBlockers[0];
    } else if (/\b(?:second|2nd)\b/i.test(lower) && lastPresentedBlockers.length > 1) {
      target = lastPresentedBlockers[1];
    } else if (/\b(?:third|3rd)\b/i.test(lower) && lastPresentedBlockers.length > 2) {
      target = lastPresentedBlockers[2];
    }
  }

  if (!target) {
    target = activeBlocker || lastPresentedBlockers?.[0] || null;
  }

  if (!target) {
    const projectBlockers = extractProjectBlockers(projectId);
    target = projectBlockers[0] || null;
  }

  if (!target) {
    const allBlocked = backgroundTaskManager.listTasks({ limit: 50 }).filter((t) => t.status === 'blocked');
    if (allBlocked.length > 0) {
      target = {
        taskId: allBlocked[0].taskId,
        title: allBlocked[0].title,
        reason: allBlocked[0].blocker || 'Unspecified blocker',
        worker: allBlocked[0].worker || undefined,
        metadata: typeof allBlocked[0].metadata === 'object' ? (allBlocked[0].metadata as Record<string, unknown>) : undefined,
        objective: allBlocked[0].objective || undefined,
        projectId: allBlocked[0].projectId || projectId,
      };
    }
  }

  if (!target) {
    return {
      handled: true,
      spokenText: 'I found no blocked tasks recorded for this project.',
      activeBlocker: null,
      subIntent: 'general',
      detailFound: false,
      credentialProvider: 'UNSPECIFIED_IN_AUTHORITATIVE_STATE',
      dataSource: 'background_tasks',
    };
  }

  // 2. Query authoritative task details from backgroundTaskManager / SQLite
  const taskRecord = backgroundTaskManager.getTask(target.taskId) || target;
  const blockerReason = target.reason || (taskRecord as any).blocker || 'Missing external credentials';
  const taskTitle = target.title || (taskRecord as any).title;
  const objective = target.objective || (taskRecord as any).objective || 'Configure external FreeCash API credentials and account connectivity';
  const worker = target.worker || (taskRecord as any).worker || 'automation';

  // 3. Inspect metadata and task events for explicit provider/API specification
  let credentialProvider = 'UNSPECIFIED_IN_AUTHORITATIVE_STATE';
  let detailFound = false;

  let rawMeta: any = (taskRecord as any).metadata;
  if (typeof rawMeta === 'string') {
    try { rawMeta = JSON.parse(rawMeta); } catch {}
  }
  rawMeta = rawMeta && typeof rawMeta === 'object' ? rawMeta : {};

  if (rawMeta.provider && typeof rawMeta.provider === 'string') {
    credentialProvider = rawMeta.provider;
    detailFound = true;
  } else if (rawMeta.apiProvider && typeof rawMeta.apiProvider === 'string') {
    credentialProvider = rawMeta.apiProvider;
    detailFound = true;
  } else if (rawMeta.service && typeof rawMeta.service === 'string') {
    credentialProvider = rawMeta.service;
    detailFound = true;
  } else {
    // Check if task objective / request specifies a distinct third-party provider (e.g. Stripe, Shopify)
    const combined = `${taskTitle} ${objective} ${(taskRecord as any).originalRequest || ''}`;
    const m = combined.match(/\b(stripe|shopify|amazon|openrouter|paypal)\b/i);
    if (m) {
      credentialProvider = m[1].charAt(0).toUpperCase() + m[1].slice(1);
      detailFound = true;
    }
  }

  // 4. Sub-intent classification
  let subIntent: BlockerDetailResult['subIntent'] = 'general';
  if (/\b(?:which\s+(?:one|task)|for\s+which(?:\s+one)?|which\s+one\s+is\s+missing|what\s+(?:is\s+(?:that|the)\s+blocker|task))\b/i.test(lower)) {
    subIntent = 'which_task';
  } else if (/\b(?:which\s+api(?:\s+keys?)?|which\s+credentials?|what\s+api(?:\s+keys?)?|what\s+credentials?(?:\s+are\s+missing)?|what\s+exactly\s+is\s+missing)\b/i.test(lower)) {
    subIntent = 'which_api';
  } else if (/\b(?:why\s+(?:is\s+(?:it|that|the\s+task|the\s+blocker|that\s+blocker)\b|does\s+it\s+need\s+(?:them|credentials|api\s*keys?)|are\s+they\s+needed)|why\s+can'?t\s+it\s+proceed)\b/i.test(lower)) {
    subIntent = 'why_blocked';
  } else if (/\b(?:who\s+needs\s+(?:them|the\s+credentials|the\s+api\s*keys?)|which\s+worker\s+needs)\b/i.test(lower)) {
    subIntent = 'who_needs';
  } else if (/\b(?:where\s+do\s+i\s+get\s+them|where\s+to\s+get|how\s+do\s+i\s+provide\s+them)\b/i.test(lower)) {
    subIntent = 'where_get';
  }

  // 5. Generate truthful response
  let spokenText = '';
  switch (subIntent) {
    case 'which_task':
      spokenText = `The blocked task is "${taskTitle}". Blocker: ${blockerReason}.`;
      break;
    case 'which_api':
      if (detailFound && credentialProvider !== 'UNSPECIFIED_IN_AUTHORITATIVE_STATE') {
        spokenText = `The blocked task is "${taskTitle}". It is waiting for the ${credentialProvider} API credentials.`;
      } else {
        spokenText = `The blocked task is "${taskTitle}". The task record only says external Free Cash API keys/credentials are missing; it does not currently specify which provider or API.`;
      }
      break;
    case 'why_blocked':
      spokenText = `It is blocked because: ${blockerReason}. The task objective is ${objective}.`;
      break;
    case 'who_needs':
      spokenText = `The ${worker} worker needs them for the task "${taskTitle}".`;
      break;
    case 'where_get':
      spokenText = `They need to be configured in your Free Cash account or external settings for account connectivity.`;
      break;
    default:
      spokenText = `The blocked task is "${taskTitle}". Blocker: ${blockerReason}.`;
      break;
  }

  logger.info('[BlockerDetail] QUERY_RESULT', {
    conversationId,
    prompt,
    projectId,
    activeBlockerId: target.taskId,
    activeBlockerTitle: taskTitle,
    subIntent,
    detailFound,
    credentialProvider,
    spokenText,
  });

  console.log(`[BlockerDetail] TURN_ID=${conversationId} PROMPT="${prompt}" ACTIVE_PROJECT=${projectId} ACTIVE_BLOCKER_ID=${target.taskId} ACTIVE_BLOCKER_TITLE="${taskTitle}" INTENT=BLOCKER_DETAIL_READ ROUTE=BLOCKER_DETAIL_READ DATA_SOURCE=background_tasks DETAIL_FOUND=${detailFound} FINAL_TEXT_LENGTH=${spokenText.length} FINAL_RESPONSE="${spokenText}"`);

  return {
    handled: true,
    spokenText,
    activeBlocker: target,
    subIntent,
    detailFound,
    credentialProvider,
    dataSource: 'background_tasks',
  };
}
