/**
 * BackgroundTaskManager — single orchestration layer behind Jarvis.
 *
 * Separation contract (Milestone requirement 1):
 *   - Conversation messages NEVER cancel or replace tasks.
 *   - Only explicit task-control commands (pause/resume/stop/cancel/retry)
 *     mutate task state.
 *   - Tasks persist in SQLite (server/src/services/backgroundTasks/store.ts)
 *     and survive renderer refresh, route changes, and backend restarts.
 *
 * Worker adapters own worker-specific execution; the manager owns
 * orchestration state, limits, event normalization, and Board linkage.
 */
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { backgroundTaskRepo } from './store.js';
import {
  TERMINAL_STATUSES,
  TASK_LIMITS,
  isActiveStatus,
  taskShortId,
  type BackgroundTaskEvent,
  type BackgroundTaskRecord,
  type TaskApprovalRequest,
  type TaskEventKind,
  type TaskStatus,
  type WorkerKind,
} from './types.js';
import { localDataPort } from '../../adapters/localDataPort.js';
import { logger } from '../../utils/logger.js';
import { policyStore } from '../policy/policyStore.js';
import { getHardwareProfile } from '../system/hardwareProfiler.js';
import {
  classifyAndDecide, applyDecisionToBudget, recoveryStatusLabel,
  type LocalHarnessContext,
} from '../recovery/localHarness.js';
import {
  DEFAULT_RECOVERY_POLICY, newBudgetUsage, type RecoveryBudgetUsage, type RecoveryDecision,
} from '../recovery/policy.js';
import { getWorkspaceRoot } from '../workspaceStore.js';
import * as executionState from '../executionState.js';

/** Extract "Top prospect: X" (or the first numbered result) from a worker result. */
function extractTopResult(result: string | null | undefined): string | null {
  if (!result) return null;
  const top = result.match(/Top prospect:\s*([^\n]+)/i);
  if (top?.[1]) return top[1].trim();
  const first = result.match(/^\s*1[.)]\s*(.+)$/m);
  if (first?.[1]) return first[1].trim().slice(0, 80);
  return null;
}

/** Extract the returned lead count from a revenue result ("COMPLETED 10/10"). */
function extractResultCount(result: string | null | undefined): number | null {
  if (!result) return null;
  const completed = result.match(/COMPLETED\s+(\d+)\s*\/\s*(\d+)/i);
  if (completed?.[1]) return Number(completed[1]);
  const qualified = result.match(/(\d+)\s+qualified lead/i);
  if (qualified?.[1]) return Number(qualified[1]);
  return null;
}
import { routingLedger } from '../routingLedger.js';
import { db as jsonDb } from '../../services/db.js';

export interface CreateTaskInput {
  title: string;
  objective: string;
  originalRequest: string;
  route: string;
  selectedAgent: string;
  worker: WorkerKind;
  priority?: 'low' | 'medium' | 'high';
  projectId?: string | null;
  conversationId?: string | null;
  conversationSessionId?: string | null;
  resumable?: boolean;
  metadata?: Record<string, unknown>;
  /**
   * Canonical workspace root the task resolves files against (§1–§2).
   * Captured at creation time: if the user later changes repository, this
   * task keeps its original root (§9 — never silently redirected).
   * Falls back to the canonical workspaceStore root when omitted.
   */
  workspaceRoot?: string;
  /** Retry rule (req. 10): reuse an existing Board card instead of creating one. */
  boardCardId?: string | null;
}

const MAX_EVENTS_MEMORY_PER_TASK = 400;

/** Task → Board lane mapping (existing b-hermes board, requirement 10). */
const STATUS_TO_LANE: Record<TaskStatus, string> = {
  queued: 'l-hermes-backlog',
  planning: 'l-hermes-inprogress-hermes',
  running: 'l-hermes-inprogress-hermes',
  verifying: 'l-hermes-review',
  waiting_approval: 'l-hermes-blocked',
  paused: 'l-hermes-blocked',
  review: 'l-hermes-review',
  completed: 'l-hermes-done',
  blocked: 'l-hermes-blocked',
  failed: 'l-hermes-blocked',
  cancelled: 'l-hermes-blocked',
};

export class BackgroundTaskManager extends EventEmitter {
  private seqCounter = 0;
  /** Per-task in-memory event ring (persisted to SQLite as source of truth). */
  private eventBuffers = new Map<string, BackgroundTaskEvent[]>();
  private approvalRequests = new Map<string, TaskApprovalRequest>();
  /** Registered worker stop callbacks — adapters register at dispatch time. */
  private stopHandlers = new Map<string, () => Promise<void> | void>();
  /** Registered worker pause callbacks (only when genuinely resumable). */
  private pauseHandlers = new Map<string, () => Promise<void> | void>();
  private resumeHandlers = new Map<string, () => Promise<void> | void>();
  /**
   * Registered approval resolvers — workers that WAIT on a human approval
   * mid-execution (e.g. the revenue pipeline) register a callback that
   * receives the resolved choice ('allow' | 'deny'). Invoked inside
   * resolveApproval after the worker-specific bridge runs.
   */
  private approvalResolvers = new Map<string, (choice: 'allow' | 'deny') => Promise<void> | void>();
  private restored = false;

  constructor() {
    super();
    this.setMaxListeners(50);
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  /** Restore interrupted tasks after backend restart (requirement 3). */
  restoreAfterRestart(): void {
    if (this.restored) return;
    this.restored = true;
    try {
      const interrupted = backgroundTaskRepo.listTasks({ activeOnly: true });
      for (const task of interrupted) {
        if (task.worker === 'codex' && task.resumable && (task.status === 'running' || task.status === 'paused')) {
          // CodeX checkpoints survive restart; leave paused/running as-is —
          // the worker adapter reattaches on demand (no silent auto-restart).
          this.appendEvent(task.taskId, 'task.progress',
            `Task restored after backend restart — ${task.status}, resumable via checkpoint.`);
          continue;
        }
        if (task.status === 'running' || task.status === 'planning') {
          // Non-resumable workers (Hermes live run, research) cannot prove
          // continuity across a backend restart — mark blocked truthfully.
          this.transition(task.taskId, 'blocked', {
            blocker: 'Backend restarted while this task was in progress. The worker’s live state was lost — resume or retry the task to continue.',
          });
        }
      }
    } catch (err: any) {
      logger.warn(`[bg-task] restoreAfterRestart failed: ${err?.message}`);
    }
  }

  /** Create + persist a task. Enforces concurrency limits (requirement 15). */
  createTask(input: CreateTaskInput): { task?: BackgroundTaskRecord; error?: string } {
    const active = backgroundTaskRepo.listTasks({ activeOnly: true });
    const activeCount = active.filter(t => isActiveStatus(t.status) && t.status !== 'queued').length;
    const queuedCount = active.filter(t => t.status === 'queued').length;

    if (activeCount >= TASK_LIMITS.maxActiveGlobal) {
      return { error: `Concurrency limit reached (${TASK_LIMITS.maxActiveGlobal} active tasks). Stop or finish a task first.` };
    }
    if (queuedCount >= TASK_LIMITS.maxQueued) {
      return { error: `Queue is full (${TASK_LIMITS.maxQueued} queued tasks).` };
    }
    const perWorkerActive = active.filter(t => t.worker === input.worker && isActiveStatus(t.status)).length;
    const workerLimit =
      input.worker === 'hermes' ? TASK_LIMITS.maxActiveHermes
      : input.worker === 'codex' ? TASK_LIMITS.maxActiveCodex
      : input.worker === 'team' ? TASK_LIMITS.maxActiveTeam
      : TASK_LIMITS.maxActiveGlobal;
    // PRIORITY 10: when the worker is at its limit, QUEUE instead of rejecting.
    // The task is created queued with concurrency metadata so the UI shows
    // "QUEUED — waiting for Hermes (active 1/1, position N)" instead of a fake
    // DISPATCHING state or a hard error. The pump dispatches it when a slot
    // frees (see transition → pumpQueuedForWorker).
    const atWorkerLimit = perWorkerActive >= workerLimit;
    const queueConcurrencyMeta = atWorkerLimit
      ? { concurrency: { active: perWorkerActive, limit: workerLimit, position: queuedCount + 1, blocked: true } }
      : {};

    const now = new Date().toISOString();
    const task: BackgroundTaskRecord = {
      taskId: `bgtask-${randomUUID().replace(/-/g, '').slice(0, 9)}`,
      title: input.title,
      objective: input.objective,
      originalRequest: input.originalRequest,
      route: input.route,
      selectedAgent: input.selectedAgent,
      status: 'queued',
      priority: input.priority || 'medium',
      projectId: input.projectId || null,
      createdAt: now,
      startedAt: null,
      updatedAt: now,
      completedAt: null,
      conversationId: input.conversationId || null,
      conversationSessionId: input.conversationSessionId || null,
      worker: input.worker,
      linkedRunId: null,
      linkedBoardCardId: input.boardCardId || null,
      parentTaskId: null,
      childTaskIds: [],
      currentStage: 'queued',
      progressMessage: 'Task created and queued.',
      filesChanged: [],
      buildState: 'idle',
      testState: 'idle',
      verificationState: 'pending',
      approvalState: 'none',
      blocker: null,
      lastError: null,
      cancellationRequested: false,
      resumable: input.resumable || false,
      resultText: null,
      attempt: 1,
      metadata: { ...(input.metadata || {}), ...queueConcurrencyMeta },
      // §1/§9: the canonical workspace root captured AT CREATION. A later
      // repository change must never silently redirect a running task.
      workspaceRoot: input.workspaceRoot ?? getWorkspaceRoot(),
    };

    backgroundTaskRepo.insertTask(task);
    this.appendEvent(task.taskId, 'task.created', `Task ${taskShortId(task.taskId)} created — ${task.title}`, { worker: task.worker });
    this.appendEvent(task.taskId, atWorkerLimit ? 'task.blocked' : 'task.queued', atWorkerLimit
      ? `Queued behind ${task.worker} — active ${perWorkerActive}/${workerLimit}, position ${queuedCount + 1}`
      : 'Task queued for execution.');
    this.linkBoardCard(task);

    // Canonical execution record (coherence milestone): the stream began the
    // operation under metadata.operationId — adopt it as QUEUED with the
    // task-owned cancel action.
    const opId = (task.metadata as any)?.operationId as string | undefined;
    if (opId) {
      executionState.update(opId, {
        status: 'QUEUED',
        worker: task.worker === 'hermes' ? 'hermes' : task.worker === 'codex' ? 'codex' : task.worker === 'revenue' ? 'revenue' : 'other',
        currentAction: atWorkerLimit
          ? `Waiting for ${task.worker} slot — active ${perWorkerActive}/${workerLimit}, position ${queuedCount + 1}`
          : `Task ${taskShortId(task.taskId)} queued: ${task.title.slice(0, 60)}`,
        queuePosition: atWorkerLimit ? queuedCount + 1 : null,
        activeCount: perWorkerActive,
        limit: workerLimit,
        cancel: { kind: 'task', id: task.taskId },
      });
    }
    return { task };
  }

  /**
   * PRIORITY 10: when a worker's slot frees, dispatch the oldest queued task
   * that was blocked on concurrency. Dynamic import avoids a module cycle
   * (adapters statically import this manager).
   */
  async pumpQueuedForWorker(worker: string): Promise<void> {
    try {
      const queued = this.listTasks({ activeOnly: true })
        .filter(t => t.worker === worker && t.status === 'queued' && (t.metadata as any)?.concurrency?.blocked);
      if (!queued.length) return;
      const active = this.listTasks({ activeOnly: true })
        .filter(t => t.worker === worker && isActiveStatus(t.status) && t.status !== 'queued').length;
      const workerLimit =
        worker === 'hermes' ? TASK_LIMITS.maxActiveHermes
        : worker === 'codex' ? TASK_LIMITS.maxActiveCodex
        : worker === 'team' ? TASK_LIMITS.maxActiveTeam
        : TASK_LIMITS.maxActiveGlobal;
      if (active >= workerLimit) return;
      const next = queued.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))[0];
      logger.info(`[bg-task] pump: dispatching queued ${next.taskId} for ${worker} (active ${active}/${workerLimit})`);
      const { dispatchTask } = await import('./adapters.js');
      const result = await dispatchTask(next);
      if (!result.ok) {
        this.transition(next.taskId, 'blocked', { lastError: result.error || 'Dispatch failed' });
      }
    } catch (err: any) {
      logger.warn('[bg-task] pump failed', err);
    }
  }

  // ── State transitions (the ONLY mutators) ────────────────────────────────

  /**
   * Guarded status transition. Terminal states are immutable — a late worker
   * event can never move a cancelled task back to completed (Test F).
   */
  transition(taskId: string, status: TaskStatus, patch: Partial<BackgroundTaskRecord> = {}): BackgroundTaskRecord | null {
    const task = backgroundTaskRepo.getTask(taskId);
    if (!task) return null;
    if (TERMINAL_STATUSES.has(task.status)) {
      logger.info(`[bg-task] Ignored transition ${task.status}→${status} for terminal task ${taskId}`);
      return task;
    }
    const now = new Date().toISOString();
    const merged: Partial<BackgroundTaskRecord> = { ...patch, status };
    if (status === 'running' && !task.startedAt) merged.startedAt = now;
    if (TERMINAL_STATUSES.has(status)) merged.completedAt = now;
    const updated = backgroundTaskRepo.updateTask(taskId, merged);
    if (updated) {
      // Canonical execution record (coherence milestone): mirror the
      // transition onto the shared execution record (operationId = the
      // metadata.operationId the stream registered).
      const opId = (task.metadata as any)?.operationId as string | undefined;
      if (opId) {
        if (TERMINAL_STATUSES.has(status)) {
          const execStatus = status === 'completed' ? 'COMPLETED' : status === 'cancelled' ? 'CANCELLED' : 'FAILED';
          executionState.end(opId, execStatus, (updated.resultText || undefined) as string | undefined);
          // Routing-ledger consistency (step 7): every task-backed operation
          // records its requested vs resolved provider/model in the ledger.
          const rec = executionState.get(opId);
          if (rec) {
            routingLedger.record({
              operationId: opId,
              worker: rec.worker,
              routingMode: 'auto',
              requestedProvider: rec.requestedProvider,
              requestedModel: rec.requestedModel,
              resolvedProvider: rec.resolvedProvider,
              resolvedModel: rec.resolvedModel,
              fallbackUsed: rec.fallbackUsed,
              fallbackReason: rec.resolvedProvider && !rec.requestedProvider ? null : rec.fallbackReason,
              startedAt: rec.startedAt,
              endedAt: rec.endedAt,
            });
          }
          // TASK_COMPLETED user-experience event (task-completion milestone):
          // publish ONE semantic completion event (text + spoken summary come
          // from the same event). Fire-and-forget — never blocks the transition.
          void (async () => {
            try {
              const { buildCompletionEvent } = await import('../completionSummary.js');
              const { publishCompletion } = await import('../../routers/execution.js');
              const rec = executionState.get(opId);
              if (rec) {
                const meta = (task.metadata || {}) as Record<string, any>;
                const requestedCount = typeof meta.prospectCount === 'number' ? meta.prospectCount : null;
                const resultCount = rec.qualifiedCount != null && requestedCount != null
                  ? Math.min(rec.qualifiedCount, requestedCount)
                  : (extractResultCount(rec.result) ?? rec.qualifiedCount);
                const topResult = extractTopResult(rec.result);
                const evt = buildCompletionEvent(rec, {
                  taskId: task.taskId,
                  conversationId: task.conversationId ?? null,
                  taskType: task.worker === 'revenue' ? 'revenue search' : task.worker === 'codex' ? 'code inspection' : task.worker,
                  niche: meta.niche ?? null,
                  city: meta.city ?? null,
                  requestedCount,
                  resultCount,
                  topResult,
                  detail: status === 'failed' ? (updated.blocker || updated.lastError || null) : null,
                });
                if (evt) publishCompletion(evt);
                // Memory distillation (memory milestone): meaningful terminal
                // tasks create episodic/semantic memories with provenance.
                const { distillFromExecution } = await import('../memory/distill.js');
                distillFromExecution(rec, {
                  taskId: task.taskId,
                  conversationId: task.conversationId ?? null,
                  projectId: task.projectId ?? null,
                  niche: meta.niche ?? null,
                  city: meta.city ?? null,
                  requestedCount,
                  resultCount,
                  topResult,
                  detail: status === 'failed' ? (updated.blocker || updated.lastError || null) : null,
                  verificationState: updated.verificationState ?? null,
                  gateResults: Array.isArray(updated.metadata?.gateResults) ? updated.metadata.gateResults : null,
                });
              }
            } catch { /* completion event + distillation must never break the transition */ }
          })();
        } else {
          const execStatus = status === 'running' ? 'RUNNING'
            : status === 'waiting_approval' ? 'WAITING_FOR_APPROVAL'
            : status === 'queued' ? 'QUEUED' : 'RUNNING';
          executionState.update(opId, { status: execStatus, currentAction: updated.progressMessage || updated.currentStage || undefined });
        }
      }
      // Worker result return (P10): a completed task delivers its result into
      // the Jarvis conversation automatically — the user never has to open a
      // side panel to discover what the worker found.
      if (status === 'completed' && task.conversationId && (updated.resultText || task.resultText)) {
        const resultText = String(updated.resultText || task.resultText || '').slice(0, 2000);
        void (async () => {
          try {
            const { conversationService } = await import('../../domains/conversations/service.js');
            await conversationService.appendMessage({
              conversationId: task.conversationId as string,
              role: 'agent',
              content: `Completed — here is what I found:\n${resultText}`,
              routedAgent: 'jarvis',
              metadata: { taskId: task.taskId, provider: 'agentic-os', model: 'task-manager', resultReturn: true },
            });
          } catch (err: any) {
            logger.warn(`[bg-task] result-return append failed for ${task.taskId}: ${err?.message}`);
          }
        })();
      }
      // PRIORITY 10: a terminal transition frees a worker slot — dispatch the
      // oldest queued task for that worker (fire-and-forget).
      if (TERMINAL_STATUSES.has(status)) {
        void this.pumpQueuedForWorker(task.worker);
      }
      const kindMap: Partial<Record<TaskStatus, TaskEventKind>> = {
        running: 'task.started',
        paused: 'task.paused',
        cancelled: 'task.cancelled',
        completed: 'task.completed',
        failed: 'task.failed',
        blocked: 'task.blocked',
        review: 'task.review_started',
        waiting_approval: 'task.approval_requested',
      };
      const kind = kindMap[status];
      if (kind && status !== task.status) {
        this.appendEvent(taskId, kind, `Status → ${status}${patch.blocker ? `: ${patch.blocker}` : ''}`);
      }
      this.syncBoardCard(updated);
      this.writeHandoff(updated); // requirement 14 — compact handoff on terminal/blocked states
      this.emit('task:updated', updated);
    }
    return updated;
  }

  /**
   * Requirement 14: save a compact handoff for completed/blocked/failed tasks
   * into the EXISTING memory system (memoryEntries JsonStore — the same store
   * behind /api/memory/entries). One entry per task (metadata.handoffWritten
   * guard) — no duplicate memory system, no duplicates on re-transitions.
   */
  private writeHandoff(task: BackgroundTaskRecord): void {
    if (!['completed', 'blocked', 'failed'].includes(task.status)) return;
    if (task.metadata?.handoffWritten) return;
    try {
      const events = backgroundTaskRepo.getEvents(task.taskId);
      const decisions = events
        .filter(e => e.kind === 'task.approval_resolved' || e.kind === 'task.approval_requested')
        .map(e => e.summary)
        .slice(-3);
      const checks: string[] = [];
      if (task.buildState !== 'idle') checks.push(`build ${task.buildState}`);
      if (task.testState !== 'idle') checks.push(`tests ${task.testState}`);
      checks.push(`verification ${task.verificationState}`);
      const nextStep =
        task.status === 'completed' ? 'None — task finished and verified.'
        : task.status === 'blocked' ? 'Resolve the blocker, then resume or retry the task.'
        : 'Inspect the last error, fix the cause, and retry the task.';
      const content = [
        `Objective: ${task.objective}`,
        `Agents: ${task.selectedAgent} (worker: ${task.worker})`,
        `Run: ${task.linkedRunId || '—'}`,
        `Files changed: ${task.filesChanged.length ? task.filesChanged.join(', ') : 'none'}`,
        `Checks run: ${checks.join('; ')}`,
        `Result: ${(task.resultText || task.blocker || task.lastError || task.progressMessage || '—').slice(0, 600)}`,
        `Verification: ${task.verificationState}`,
        `Board card: ${task.linkedBoardCardId || '—'}`,
        decisions.length ? `Decisions: ${decisions.join(' | ')}` : '',
        task.blocker ? `Blocker: ${task.blocker}` : '',
        `Recommended next step: ${nextStep}`,
      ].filter(Boolean).join('\n');
      const now = new Date().toISOString();
      jsonDb.memoryEntries.upsert({
        id: `mem-task-${task.taskId}`,
        scopeId: 'mem-jarvis-agent',
        kind: task.status === 'completed' ? 'summary' : 'decision',
        title: `Task handoff: ${task.title} (${task.status})`,
        content,
        links: task.linkedBoardCardId ? [`board:${task.linkedBoardCardId}`] : [],
        sourceRunId: task.linkedRunId || undefined,
        sourceType: 'background-task',
        sourceId: task.taskId,
        createdAt: now,
        updatedAt: now,
      });
      backgroundTaskRepo.updateTask(task.taskId, { metadata: { ...task.metadata, handoffWritten: true } });
      logger.info(`[bg-task] handoff saved for ${task.taskId} (${task.status})`);
    } catch (err: any) {
      logger.warn(`[bg-task] handoff write failed for ${task.taskId}: ${err?.message}`);
    }
  }

  /** Append progress/stage/file events without changing status. */
  progress(taskId: string, kind: TaskEventKind, summary: string, patch: Partial<BackgroundTaskRecord> = {}, detail: Record<string, unknown> = {}): BackgroundTaskRecord | null {
    const task = backgroundTaskRepo.getTask(taskId);
    if (!task || TERMINAL_STATUSES.has(task.status)) return task;
    // Identity fields are set at creation only — a progress event must NEVER
    // rewrite the worker column (a routing label like { worker: 'hermes' }
    // must stay in `detail`, not the row patch).
    const safePatch = { ...patch };
    delete safePatch.worker;
    const updated = Object.keys(safePatch).length
      ? backgroundTaskRepo.updateTask(taskId, safePatch)
      : task;
    this.appendEvent(taskId, kind, summary, detail);
    // Canonical count mirror (contact-quality milestone): revenue progress
    // events carry {discovered, qualified, rejected, requested} in the patch
    // (3rd arg) or detail (4th arg) — expose the same numbers on the
    // canonical execution record so the bar/activity panel show live pipeline
    // progress without any second source.
    const opId = (task.metadata as any)?.operationId as string | undefined;
    const counts = { ...safePatch, ...detail } as Record<string, unknown>;
    if (opId && (counts.discovered !== undefined || counts.qualified !== undefined || counts.rejected !== undefined || counts.requested !== undefined || counts.expanded !== undefined)) {
      // Only overwrite a count field when this event actually carries it —
      // a later event without `discovered` must not null it out.
      const countPatch: Record<string, unknown> = { currentAction: summary };
      if (typeof counts.discovered === 'number') countPatch.discoveredCount = counts.discovered;
      if (typeof counts.qualified === 'number') countPatch.qualifiedCount = counts.qualified;
      if (typeof counts.rejected === 'number') countPatch.rejectedCount = counts.rejected;
      if (typeof counts.requested === 'number') countPatch.targetCount = counts.requested;
      executionState.updateRecord(opId, countPatch as any);
    }
    if (updated && updated.progressMessage !== task.progressMessage) {
      this.emit('task:updated', updated);
    }
    return updated;
  }

  appendEvent(taskId: string, kind: TaskEventKind, summary: string, detail: Record<string, unknown> = {}): BackgroundTaskEvent {
    const seq = backgroundTaskRepo.lastSequence(taskId) + 1;
    const evt: BackgroundTaskEvent = {
      id: `bgevt-${Date.now().toString(36)}-${(++this.seqCounter).toString(36)}`,
      taskId,
      ts: new Date().toISOString(),
      kind,
      summary,
      detail,
      sequence: seq,
    };
    try {
      backgroundTaskRepo.insertEvent(evt);
    } catch (err: any) {
      logger.warn(`[bg-task] event persist failed: ${err?.message}`);
    }
    const buf = this.eventBuffers.get(taskId) || [];
    buf.push(evt);
    if (buf.length > MAX_EVENTS_MEMORY_PER_TASK) buf.shift();
    this.eventBuffers.set(taskId, buf);
    this.emit('task:event', evt);
    return evt;
  }

  // ── Worker handler registration (adapters call these) ───────────────────

  registerWorkerHandlers(taskId: string, handlers: {
    stop?: () => Promise<void> | void;
    pause?: () => Promise<void> | void;
    resume?: () => Promise<void> | void;
  }): void {
    if (handlers.stop) this.stopHandlers.set(taskId, handlers.stop);
    if (handlers.pause) this.pauseHandlers.set(taskId, handlers.pause);
    if (handlers.resume) this.resumeHandlers.set(taskId, handlers.resume);
  }

  /** Workers that WAIT on approvals register a resolver that receives the choice. */
  registerApprovalResolver(taskId: string, resolver: (choice: 'allow' | 'deny') => Promise<void> | void): void {
    this.approvalResolvers.set(taskId, resolver);
  }

  // ── Explicit task-control commands (the ONLY way conversation touches tasks)

  async stopTask(taskId: string, reason = 'Stopped by user command.'): Promise<{ ok: boolean; error?: string; task?: BackgroundTaskRecord }> {
    const task = backgroundTaskRepo.getTask(taskId);
    if (!task) return { ok: false, error: 'Task not found.' };
    if (TERMINAL_STATUSES.has(task.status)) return { ok: false, error: `Task is already ${task.status}.`, task };
    this.appendEvent(taskId, 'task.stop_requested', `Stop requested — ${reason}`);
    const handler = this.stopHandlers.get(taskId);
    try {
      if (handler) await handler();
      // Worker's own terminal event should land; enforce truthful state if silent.
      setTimeout(() => {
        const current = backgroundTaskRepo.getTask(taskId);
        if (current && !TERMINAL_STATUSES.has(current.status) && current.cancellationRequested) {
          this.transition(taskId, 'cancelled', { blocker: reason });
        }
      }, 4000);
      const updated = backgroundTaskRepo.updateTask(taskId, { cancellationRequested: true });
      return { ok: true, task: updated || task };
    } catch (err: any) {
      this.transition(taskId, 'blocked', { blocker: `Stop failed: ${err?.message}` });
      return { ok: false, error: `Stop failed: ${err?.message}` };
    }
  }

  async pauseTask(taskId: string): Promise<{ ok: boolean; error?: string; task?: BackgroundTaskRecord }> {
    const task = backgroundTaskRepo.getTask(taskId);
    if (!task) return { ok: false, error: 'Task not found.' };
    if (TERMINAL_STATUSES.has(task.status)) return { ok: false, error: `Task is already ${task.status}.`, task };
    if (!task.resumable) {
      // Requirement 12: never pretend. Explain and offer stop.
      return { ok: false, error: `Pause is not supported for ${task.worker} tasks — this worker cannot checkpoint and resume. Use Stop instead.` };
    }
    const handler = this.pauseHandlers.get(taskId);
    if (!handler) return { ok: false, error: 'No pause handler registered for this task.' };
    try {
      await handler();
      const updated = this.transition(taskId, 'paused', { currentStage: 'paused' });
      return { ok: true, task: updated || task };
    } catch (err: any) {
      return { ok: false, error: `Pause failed: ${err?.message}` };
    }
  }

  async resumeTask(taskId: string): Promise<{ ok: boolean; error?: string; task?: BackgroundTaskRecord }> {
    const task = backgroundTaskRepo.getTask(taskId);
    if (!task) return { ok: false, error: 'Task not found.' };
    if (task.status !== 'paused' && task.status !== 'blocked') {
      return { ok: false, error: `Only paused or blocked tasks can resume (current: ${task.status}).` };
    }
    const handler = this.resumeHandlers.get(taskId);
    if (!handler) return { ok: false, error: 'No resume handler registered for this task.' };
    try {
      await handler();
      const updated = this.transition(taskId, 'running', { blocker: null, currentStage: 'resumed' });
      this.appendEvent(taskId, 'task.resumed', 'Task resumed from checkpoint.');
      return { ok: true, task: updated || task };
    } catch (err: any) {
      return { ok: false, error: `Resume failed: ${err?.message}` };
    }
  }

  cancelTask(taskId: string, reason = 'Cancelled by user command.'): { ok: boolean; error?: string; task?: BackgroundTaskRecord } {
    const task = backgroundTaskRepo.getTask(taskId);
    if (!task) return { ok: false, error: 'Task not found.' };
    if (TERMINAL_STATUSES.has(task.status)) return { ok: false, error: `Task is already ${task.status}.`, task };
    const updated = this.transition(taskId, 'cancelled', { cancellationRequested: true, blocker: reason });
    this.stopHandlers.get(taskId)?.();
    return { ok: true, task: updated || task };
  }

  // ── Manual Board actions (Project Board explicit controls) ──────────────
  // These are USER-driven state transitions from the Project Workspace board.
  // They use the same guarded transition + real event store as worker events,
  // so the board reflects real task state and Live Work shows real events.
  // Manual completion is a user override: verificationState is 'skipped'
  // (no build/test gate ran) and resultText explains it was board-completed.

  startTask(taskId: string): { ok: boolean; error?: string; task?: BackgroundTaskRecord } {
    const task = backgroundTaskRepo.getTask(taskId);
    if (!task) return { ok: false, error: 'Task not found.' };
    if (TERMINAL_STATUSES.has(task.status)) return { ok: false, error: `Cannot start a ${task.status} task.`, task };
    if (task.status === 'running' || task.status === 'planning') return { ok: true, task };
    const updated = this.transition(taskId, 'running', { currentStage: 'started', blocker: null, progressMessage: 'Started from the Project Board.' });
    this.appendEvent(taskId, 'task.started', 'Task started from the Project Board.', { source: 'project-board' });
    return { ok: true, task: updated || task };
  }

  blockTask(taskId: string, reason = 'Blocked from the Project Board.'): { ok: boolean; error?: string; task?: BackgroundTaskRecord } {
    const task = backgroundTaskRepo.getTask(taskId);
    if (!task) return { ok: false, error: 'Task not found.' };
    if (TERMINAL_STATUSES.has(task.status)) return { ok: false, error: `Cannot block a ${task.status} task.`, task };
    const updated = this.transition(taskId, 'blocked', { blocker: reason, currentStage: 'blocked' });
    this.appendEvent(taskId, 'task.blocked', reason, { source: 'project-board' });
    return { ok: true, task: updated || task };
  }

  completeTaskManual(taskId: string, reason = 'Completed from the Project Board.'): { ok: boolean; error?: string; task?: BackgroundTaskRecord } {
    const task = backgroundTaskRepo.getTask(taskId);
    if (!task) return { ok: false, error: 'Task not found.' };
    if (TERMINAL_STATUSES.has(task.status)) return { ok: false, error: `Task is already ${task.status}.`, task };
    const updated = this.transition(taskId, 'completed', {
      resultText: reason,
      verificationState: 'skipped',
      currentStage: 'completed',
      progressMessage: reason,
    });
    this.appendEvent(taskId, 'task.completed', reason, { source: 'project-board', manual: true });
    return { ok: true, task: updated || task };
  }

  // ── Approvals (belong to the task, not the chat turn — requirement 11) ───

  requestApproval(taskId: string, request: Omit<TaskApprovalRequest, 'taskId'>): void {
    const task = backgroundTaskRepo.getTask(taskId);
    if (!task || TERMINAL_STATUSES.has(task.status)) return;
    this.approvalRequests.set(taskId, { taskId, ...request });
    this.transition(taskId, 'waiting_approval', { approvalState: 'pending' });
    this.appendEvent(taskId, 'task.approval_requested',
      `Approval required: ${request.action}${request.command ? ` — ${request.command}` : ''}`,
      { reason: request.reason, files: request.files });
  }

  getPendingApproval(taskId: string): TaskApprovalRequest | null {
    return this.approvalRequests.get(taskId) || null;
  }

  listPendingApprovals(): TaskApprovalRequest[] {
    return Array.from(this.approvalRequests.values());
  }

  async resolveApproval(taskId: string, choice: 'allow' | 'deny', resolver: (choice: 'allow' | 'deny') => Promise<void>): Promise<{ ok: boolean; error?: string }> {
    const task = backgroundTaskRepo.getTask(taskId);
    if (!task) return { ok: false, error: 'Task not found.' };
    if (task.status !== 'waiting_approval') return { ok: false, error: `Task is not waiting for approval (current: ${task.status}).` };
    try {
      await resolver(choice);
      // Record the decision BEFORE waking any registered approval resolver
      // (e.g. the revenue pipeline gate). Otherwise the worker continuation
      // runs on a microtask while approvalState is still 'pending' and its
      // verifyCompletion gate would refuse completion as unresolved.
      this.approvalRequests.delete(taskId);
      const nextStatus = choice === 'allow' ? 'running' : 'blocked';
      this.transition(taskId, nextStatus, {
        approvalState: choice === 'allow' ? 'allowed' : 'denied',
        blocker: choice === 'deny' ? 'Action denied by user — affected operation will not execute.' : null,
      });
      this.appendEvent(taskId, 'task.approval_resolved', `Approval ${choice === 'allow' ? 'allowed' : 'denied'} by user.`);
      const registered = this.approvalResolvers.get(taskId);
      if (registered) await registered(choice);
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: `Approval resolution failed: ${err?.message}` };
    }
  }

  // ── Verification & completion (requirement 13) ──────────────────────────

  /**
   * A worker saying "done" is NOT completion. verifyCompletion gates the
   * completed status on real evidence:
   *   - result text exists (worker produced output)
   *   - no unresolved approvals
   *   - build/test state not failed (when the worker ran builds/tests)
   *   - verificationState is passed or skipped (read-only work)
   * On failure the task moves to review/blocked with a truthful explanation.
   */
  verifyCompletion(taskId: string, evidence: {
    resultText: string;
    buildState?: BackgroundTaskRecord['buildState'];
    testState?: BackgroundTaskRecord['testState'];
    readOnly?: boolean;
    verificationNote?: string;
  }): BackgroundTaskRecord | null {
    const task = backgroundTaskRepo.getTask(taskId);
    if (!task || TERMINAL_STATUSES.has(task.status)) return task;

    const problems: string[] = [];
    if (!evidence.resultText?.trim()) problems.push('No result text produced by the worker.');
    if (task.approvalState === 'pending') problems.push('An approval request is still unresolved.');
    if (evidence.buildState === 'failed') problems.push('Build failed.');
    if (evidence.testState === 'failed') problems.push('Tests failed.');

    if (problems.length) {
      const updated = this.transition(taskId, 'review', {
        resultText: evidence.resultText || null,
        verificationState: 'failed',
        blocker: `Verification failed — ${problems.join(' ')}`,
      });
      this.appendEvent(taskId, 'task.progress', `Verification blocked completion: ${problems.join(' ')}`);
      return updated;
    }

    const updated = this.transition(taskId, 'completed', {
      resultText: evidence.resultText,
      buildState: evidence.buildState || task.buildState,
      testState: evidence.testState || task.testState,
      verificationState: 'passed',
      currentStage: 'completed',
      progressMessage: evidence.verificationNote || 'Task completed and verified.',
    });
    this.appendEvent(taskId, 'task.verified', evidence.verificationNote || 'Verification passed — result accepted.', {
      readOnly: evidence.readOnly || false,
    });
    return updated;
  }

  // ── LocalHarness / RecoveryPolicy V1 ──────────────────────────────────
  // Bounded autonomous recovery on the EXISTING dispatch/gate infrastructure.
  // NEVER completes a task; only retries/escalates/reworks/blocks within the
  // declared policy, with privacy/cancellation/approval as hard stops.

  /** Read the recovery budget usage persisted on the task (default = fresh). */
  private recoveryUsage(task: BackgroundTaskRecord): RecoveryBudgetUsage {
    const m = (task.metadata || {}) as Record<string, any>;
    const r = m.recovery;
    if (r && typeof r === 'object' && typeof r.executionAttempts === 'number') {
      return {
        executionAttempts: r.executionAttempts,
        gateReworkAttempts: r.gateReworkAttempts ?? 0,
        sameModelRetries: r.sameModelRetries ?? 0,
        modelEscalations: r.modelEscalations ?? 0,
        startedAtMs: r.startedAtMs ?? Date.now(),
      };
    }
    return newBudgetUsage();
  }

  /**
   * Classify an execution/gate failure and apply the bounded next recovery
   * step. Returns the decision taken (or null when the task is terminal or
   * cancellation already dominates). Emits run.recovery.* events.
   */
  async recoverAfterFailure(
    taskId: string,
    error: unknown,
    opts: { gateEvidence?: { gateId: string; reason: string; attempt: number } } = {},
  ): Promise<RecoveryDecision | null> {
    const task = backgroundTaskRepo.getTask(taskId);
    if (!task || TERMINAL_STATUSES.has(task.status)) return null;
    if (task.cancellationRequested) {
      this.appendEvent(taskId, 'run.recovery.started', 'Recovery skipped — cancellation requested.', {});
      return { kind: 'cancelled', reason: 'CANCELLED: cancellation dominates recovery', escalationOccurred: false, budgetRemaining: false };
    }

    const used = this.recoveryUsage(task);
    const m = (task.metadata || {}) as Record<string, any>;
    const projectPolicy = task.projectId ? policyStore.getPolicy(task.projectId) : null;

    // Hardware truth (cached, advisory-only for local escalation).
    let hardwareTier: 'lite' | 'balanced' | 'quality' | 'unknown' | undefined;
    let localModels: Array<{ id: string; size?: number | null }> | undefined;
    try {
      const profile = await getHardwareProfile(false);
      hardwareTier = profile.capabilityTier;
      localModels = profile.ollama.models ?? [];
    } catch { /* hardware unavailable — local escalation stays unknown */ }

    const ctx: LocalHarnessContext = {
      policy: DEFAULT_RECOVERY_POLICY,
      projectPolicy,
      localModels,
      hardwareTier,
      assignedProvider: m.assignedProvider ?? m.agentProvider ?? null,
      assignedModel: m.assignedModel ?? null,
      used,
      taskStatus: task.status,
      cancellationRequested: task.cancellationRequested,
      gateEvidence: opts.gateEvidence ?? null,
    };

    this.appendEvent(taskId, 'run.recovery.started', `Recovery started for ${taskShortId(taskId)}.`, {
      status: task.status, worker: task.worker,
    });

    const { classification, decision } = classifyAndDecide(error, ctx);
    this.appendEvent(taskId, 'run.recovery.classified', `Failure classified as ${classification.cls}.`, {
      cls: classification.cls, reason: classification.reason, attempt: used.executionAttempts,
    });

    // Cancellation dominates — no further autonomous action.
    if (decision.kind === 'cancelled') {
      this.appendEvent(taskId, 'run.recovery.started', 'Recovery stopped (cancellation).', {});
      return decision;
    }

    // Human approval stops autonomous recovery for this branch.
    if (decision.kind === 'wait_for_approval') {
      if (task.status !== 'waiting_approval') {
        this.transition(taskId, 'waiting_approval', {
          blocker: decision.reason,
          currentStage: 'waiting_approval',
        });
      }
      this.appendEvent(taskId, 'run.recovery.started', 'Recovery stopped (human approval required).', {
        reason: decision.reason,
      });
      return decision;
    }

    const nextUsed = applyDecisionToBudget(used, decision);
    const recoveryMeta = {
      executionAttempts: nextUsed.executionAttempts,
      gateReworkAttempts: nextUsed.gateReworkAttempts,
      sameModelRetries: nextUsed.sameModelRetries,
      modelEscalations: nextUsed.modelEscalations,
      startedAtMs: used.startedAtMs,
      lastDecision: decision.kind,
      lastReason: decision.reason,
      requestedProvider: decision.effectiveProvider ?? null,
      requestedModel: decision.effectiveModel ?? null,
      effectiveProvider: decision.effectiveProvider ?? m.effectiveProvider ?? null,
      effectiveModel: decision.effectiveModel ?? m.effectiveModel ?? null,
      escalationOccurred: m.escalationOccurred ?? decision.escalationOccurred,
      escalationReason: decision.escalationReason ?? m.escalationReason ?? null,
      previousProvider: decision.previousProvider ?? m.assignedProvider ?? null,
      previousModel: decision.previousModel ?? m.assignedModel ?? null,
    };

    // RETRY / ESCALATE / REWORK: reuse the existing dispatch machinery.
    if (decision.kind === 'retry_same_model' || decision.kind === 'escalate_local_model'
        || decision.kind === 'escalate_cloud_model' || decision.kind === 'rework_after_gate_failure') {
      const eventKind = decision.kind === 'retry_same_model' ? 'run.recovery.retry'
        : decision.kind === 'rework_after_gate_failure' ? 'run.recovery.rework_started'
        : 'run.recovery.escalated';
      this.appendEvent(taskId, eventKind, decision.reason, {
        attempt: decision.attempt ?? nextUsed.executionAttempts,
        effectiveProvider: recoveryMeta.effectiveProvider,
        effectiveModel: recoveryMeta.effectiveModel,
        escalationOccurred: decision.escalationOccurred,
        escalationReason: decision.escalationReason ?? null,
      });
      // Model truth must never rewrite the ASSIGNED model.
      const metadata = {
        ...m,
        assignedProvider: m.assignedProvider ?? m.agentProvider ?? null,
        assignedModel: m.assignedModel ?? null,
        effectiveProvider: recoveryMeta.effectiveProvider,
        effectiveModel: recoveryMeta.effectiveModel,
        escalationOccurred: decision.escalationOccurred || m.escalationOccurred === true,
        escalationReason: decision.escalationReason ?? m.escalationReason ?? null,
        recovery: recoveryMeta,
      };
      this.transition(taskId, 'queued', {
        attempt: nextUsed.executionAttempts,
        lastError: classification.reason,
        blocker: null,
        metadata,
      });
      // Re-dispatch through the EXISTING production dispatcher (like the
      // router does). The pump only handles concurrency-blocked tasks, so
      // the re-queued task must be dispatched explicitly; the dispatch-once
      // guard is cleared so the recovery attempt actually runs.
      try {
        const { dispatchTask, clearDispatchGuard } = await import('./adapters.js');
        clearDispatchGuard(taskId);
        const latest = backgroundTaskRepo.getTask(taskId);
        if (latest) {
          void dispatchTask(latest).then((r) => {
            if (!r.ok && backgroundTaskRepo.getTask(taskId)?.status === 'queued') {
              this.transition(taskId, 'blocked', { lastError: r.error || 'Re-dispatch failed' });
            }
          });
        }
      } catch (e: any) {
        logger.warn(`[bg-task] recovery re-dispatch failed for ${taskId}: ${e?.message}`);
      }
      // ACTIVE RUN truth (P9): surface the recovery state through the
      // existing executionState surface — no new UI.
      try {
        const opId = (task.metadata as any)?.operationId || `${task.conversationId}:${task.worker}`;
        executionState.update(opId, {
          status: 'WAITING_FOR_MODEL',
          currentAction: recoveryStatusLabel(decision),
          note: decision.reason,
        });
      } catch { /* best effort */ }
      this.appendEvent(taskId, 'run.recovery.completed', `Recovery step scheduled: ${decision.kind}.`, {
        nextAttempt: nextUsed.executionAttempts,
      });
      return decision;
    }

    // BLOCKED (budget exhausted / policy / non-retryable).
    if (decision.kind === 'blocked') {
      const isPolicy = decision.blockedByPolicy === true || /POLICY_BLOCKED/i.test(decision.reason);
      this.appendEvent(taskId, isPolicy ? 'run.recovery.blocked_by_policy' : 'run.recovery.exhausted',
        decision.reason, { attempt: used.executionAttempts });
      this.transition(taskId, 'blocked', {
        blocker: decision.reason,
        currentStage: 'blocked',
        lastError: decision.reason,
        metadata: { ...m, recovery: recoveryMeta },
      });
      // ACTIVE RUN truth — clear the shared execution record for this op.
      try {
        const opId = (task.metadata as any)?.operationId || `${task.conversationId}:${task.worker}`;
        executionState.end(opId, 'FAILED', decision.reason);
      } catch { /* best effort */ }
      return decision;
    }

    return decision;
  }

  // ── Board linkage (existing Boards system — requirement 10) ─────────────

  private async linkBoardCard(task: BackgroundTaskRecord): Promise<void> {
    if (task.linkedBoardCardId) return; // never duplicate cards on restore/retry
    try {
      const laneId = STATUS_TO_LANE[task.status] || 'l-hermes-backlog';
      const card = await localDataPort.createCard({
        laneId,
        title: `${taskShortId(task.taskId)} — ${task.title}`.slice(0, 90),
        body: `${task.objective}\nWorker: ${task.worker} · Agent: ${task.selectedAgent}`,
        order: Date.now(),
        agent: task.selectedAgent,
        model: task.worker,
      });
      backgroundTaskRepo.updateTask(task.taskId, { linkedBoardCardId: card.id });
      this.appendEvent(task.taskId, 'task.board_linked', `Board card linked (${card.id}).`, { cardId: card.id });
    } catch (err: any) {
      logger.warn(`[bg-task] Board linkage failed for ${task.taskId}: ${err?.message}`);
    }
  }

  private async syncBoardCard(task: BackgroundTaskRecord): Promise<void> {
    if (!task.linkedBoardCardId) return;
    try {
      const laneId = STATUS_TO_LANE[task.status];
      const cardState =
        task.status === 'completed' ? 'done'
        : task.status === 'failed' || task.status === 'blocked' || task.status === 'cancelled' ? 'error'
        : task.status === 'running' || task.status === 'planning' ? 'running'
        : 'idle';
      await localDataPort.setCardState(task.linkedBoardCardId, cardState as any);
      await localDataPort.moveCard({ cardId: task.linkedBoardCardId, toLaneId: laneId, toOrder: Date.now() });
    } catch (err: any) {
      logger.warn(`[bg-task] Board sync failed for ${task.taskId}: ${err?.message}`);
    }
  }

  // ── Queries ──────────────────────────────────────────────────────────────

  getTask(taskId: string): BackgroundTaskRecord | null {
    return backgroundTaskRepo.getTask(taskId);
  }

  listTasks(opts?: { activeOnly?: boolean; status?: TaskStatus[]; projectId?: string | null; limit?: number }): BackgroundTaskRecord[] {
    return backgroundTaskRepo.listTasks(opts);
  }

  getEvents(taskId: string, afterSequence = 0): BackgroundTaskEvent[] {
    return backgroundTaskRepo.getEvents(taskId, afterSequence);
  }

  /** Resolve a user-facing reference like "T-104", "T-ABC123", or a full id. */
  resolveTaskRef(ref: string): BackgroundTaskRecord | null {
    const direct = backgroundTaskRepo.getTask(ref);
    if (direct) return direct;
    const short = ref.replace(/^t-?/i, '').toUpperCase();
    if (!short) return null;
    const candidates = this.listTasks({ limit: 100 });
    return candidates.find(t => taskShortId(t.taskId).toUpperCase() === `T-${short}`) || null;
  }

  summary(): { active: number; queued: number; waitingApproval: number; failedOrBlocked: number; tasks: BackgroundTaskRecord[] } {
    const tasks = this.listTasks({ limit: 50 });
    return {
      active: tasks.filter(t => isActiveStatus(t.status) && t.status !== 'queued').length,
      queued: tasks.filter(t => t.status === 'queued').length,
      waitingApproval: tasks.filter(t => t.status === 'waiting_approval').length,
      failedOrBlocked: tasks.filter(t => t.status === 'failed' || t.status === 'blocked').length,
      tasks,
    };
  }
}

export const backgroundTaskManager = new BackgroundTaskManager();
