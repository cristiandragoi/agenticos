/**
 * currentWorkContext — REAL current-work context resolution for Jarvis
 * (Phase 15, Failure C).
 *
 * Jarvis is the AgenticOS orchestrator. Questions like "What are we currently
 * working on?", "What's pending?", "What did Hermes just finish?", "What
 * failed?" MUST resolve from authoritative AgenticOS state — NEVER from
 * hard-coded phrase→canned-response mappings.
 *
 * Sources (all existing, none invented):
 *   - executionState: the single authoritative in-flight operation record
 *     (+ terminal history: latest completed / failed operation)
 *   - backgroundTaskManager: background tasks incl. status/worker/progress
 *     (running, queued, waiting_approval, failed, blocked, completed)
 *   - projectsStore: the active project
 *   - schedules table: the next scheduled worker-task run (next planned action)
 *
 * The DETECTOR is pattern-based (semantic variations are recognized), but the
 * ANSWER is assembled from the resolved state. If no authoritative state
 * exists, Jarvis says it cannot determine the current task — never invents one.
 */

import { db } from '../../db/index.js';
import { schedules } from '../../db/schema.js';

export interface CurrentWorkContext {
  activeProject: { id: string; name: string } | null;
  activeExecution: {
    worker: string;
    status: string;
    currentAction: string | null;
    provider: string | null;
    model: string | null;
    startedAt: number;
  } | null;
  latestCompletedTask: { title: string; worker: string | null; completedAt: string | null } | null;
  latestHermesRun: { title: string; status: string; updatedAt: string } | null;
  latestCodeXRun: { title: string; status: string; updatedAt: string } | null;
  pendingApproval: { title: string; taskId: string } | null;
  latestFailure: { title: string; status: string; worker: string | null; updatedAt: string } | null;
  queuedCount: number;
  runningCount: number;
  nextPlannedAction: { title: string; nextRunAt: string | null } | null;
}

/** Semantic detection — recognizes the QUESTION FAMILY, not exact phrases. */
const CURRENT_WORK_PATTERNS: RegExp[] = [
  /\b(what|which)\b.*\b(current(ly)?|right now|at the moment|now)\b.*\b(work(ing)?|task|project|milestone|focus|doing|on)\b/i,
  /\bwhat\b.*\b(are we|we're|are you)\b.*\b(working|doing|on)\b/i,
  /\bwhat's\b.*\b(the|our|my)?\s*(current|active)?\s*(task|project|work|milestone)\b/i,
  /\bwhere\b.*\b(did we leave off|left off)\b/i,
  /\bwhat\b.*\b(just)?\s*(finished|completed|done)\b.*\b(hermes|codex|task|run|work)\b/i,
  /\bwhat\b.*\b(pending|still pending|waiting|blocked|next|up next)\b/i,
  /\bwhat\b.*\b(should we do next|next step|next action)\b/i,
  /\bwhat\b.*\b(failed|broke|went wrong)\b/i,
  /\b(what are we|we are)\b.*\b(waiting for|waiting on)\b/i,
  /\b(current|active)\b.*\b(milestone|task|project)\b/i,
  /\bwhat did\b.*\b(hermes|codex)\b.*\b(just)?\s*(finish|do|complete)\b/i,
  // "Which task are we on right now?" — task noun BEFORE the time adverb.
  /\bwhich\b.*\b(task|project|work|milestone|item)\b.*\b(on|right now|now|currently)\b/i,
];

/** Question-family detector — true for any current-work phrasing. */
export function isCurrentWorkQuestion(text: string): boolean {
  const t = (text || '').trim();
  if (!t) return false;
  // Explicitly exclude identity questions that must keep the fast-path
  // (already handled by fastLocalReplies) — never hijack them.
  if (/\bwhat is (jarvis|agentic os)\b/i.test(t)) return false;
  // "what are YOU doing" is the execution-status cue (handled by the
  // execution-aware control path, which reports the live operation record).
  // Current-work questions ask about WE/the project/tasks — never hijack.
  if (/\bwhat are you doing\b/i.test(t)) return false;
  return CURRENT_WORK_PATTERNS.some((re) => re.test(t));
}

/** Resolve the structured current-work context from real AgenticOS state. */
export async function resolveCurrentWorkContext(): Promise<CurrentWorkContext> {
  const { getCurrent } = await import('../../services/executionState.js');
  const { backgroundTaskManager } = await import('../../services/backgroundTasks/manager.js');
  const { projectsStore } = await import('../../services/projectsStore.js');

  const execution = getCurrent();
  const tasks = backgroundTaskManager.listTasks({ limit: 100 });
  const activeProject = projectsStore.getActiveProject();

  // Latest terminal operations from the execution record history.
  const { snapshot } = await import('../../services/executionState.js');
  const snap = snapshot();
  const history = snap.history || [];
  const latestCompletedOp = history.find((r: any) => r.status === 'COMPLETED');
  const latestFailedOp = history.find((r: any) => r.status === 'FAILED');

  // Background tasks by interest class (newest first when the repo orders by
  // updatedAt desc — otherwise fall back to array order).
  const byWorker = (w: string) => tasks.filter((t: any) => t.worker === w);
  const hermesTasks = byWorker('hermes');
  const codexTasks = byWorker('codex');
  const latestHermesRun = hermesTasks[0] ?? null;
  const latestCodeXRun = codexTasks[0] ?? null;
  const latestCompletedTask =
    [...tasks].reverse().find((t: any) => t.status === 'completed') ?? null;
  const pendingApproval = tasks.find((t: any) => t.status === 'waiting_approval') ?? null;
  const latestFailure =
    [...tasks].reverse().find((t: any) => t.status === 'failed' || t.status === 'blocked') ?? null;
  const queuedCount = tasks.filter((t: any) => t.status === 'queued').length;
  const runningCount = tasks.filter((t: any) => t.status === 'running' || t.status === 'verifying').length;

  // Next scheduled worker-task run (the scheduler bridge dispatches real
  // worker tasks; legacy_skill schedules are SIMULATED and excluded).
  let nextPlannedAction: CurrentWorkContext['nextPlannedAction'] = null;
  try {
    const rows = await db.select().from(schedules);
    const next = (Array.isArray(rows) ? rows : [])
      .filter((s: any) => s?.active !== false && s?.executionType === 'worker_task' && s?.nextRunAt)
      .sort((a: any, b: any) => new Date(a.nextRunAt).getTime() - new Date(b.nextRunAt).getTime())[0] ?? null;
    if (next) {
      nextPlannedAction = { title: (next as any).taskTitle ?? (next as any).name ?? (next as any).taskId ?? 'scheduled task', nextRunAt: (next as any).nextRunAt ?? null };
    }
  } catch { /* schedules may not exist in dev DB — best effort */ }

  return {
    activeProject: activeProject ? { id: activeProject.id, name: activeProject.name } : null,
    activeExecution: execution
      ? {
          worker: execution.worker,
          status: execution.status,
          currentAction: execution.currentAction,
          provider: execution.resolvedProvider || execution.requestedProvider || null,
          model: execution.resolvedModel || execution.requestedModel || null,
          startedAt: execution.startedAt,
        }
      : null,
    latestCompletedTask: latestCompletedTask
      ? { title: latestCompletedTask.title, worker: latestCompletedTask.worker ?? null, completedAt: latestCompletedTask.updatedAt ?? null }
      : (latestCompletedOp
          ? { title: latestCompletedOp.result ?? `operation ${latestCompletedOp.operationId.slice(-8)}`, worker: latestCompletedOp.worker, completedAt: new Date(latestCompletedOp.endedAt ?? Date.now()).toISOString() }
          : null),
    latestHermesRun: latestHermesRun
      ? { title: latestHermesRun.title, status: latestHermesRun.status, updatedAt: latestHermesRun.updatedAt }
      : null,
    latestCodeXRun: latestCodeXRun
      ? { title: latestCodeXRun.title, status: latestCodeXRun.status, updatedAt: latestCodeXRun.updatedAt }
      : null,
    pendingApproval: pendingApproval ? { title: pendingApproval.title, taskId: pendingApproval.taskId } : null,
    latestFailure: latestFailure
      ? { title: latestFailure.title, status: latestFailure.status, worker: latestFailure.worker ?? null, updatedAt: latestFailure.updatedAt }
      : null,
    queuedCount,
    runningCount,
    nextPlannedAction,
  };
}

/** Human-readable reply assembled FROM the resolved state (never canned). */
export function formatCurrentWorkContext(ctx: CurrentWorkContext): string {
  const parts: string[] = [];

  if (ctx.activeProject) {
    parts.push(`Your active project is "${ctx.activeProject.name}".`);
  }

  if (ctx.activeExecution) {
    const workerLabel =
      ctx.activeExecution.worker === 'jarvis' ? 'Jarvis' :
      ctx.activeExecution.worker === 'codex' ? 'CodeX' :
      ctx.activeExecution.worker === 'hermes' ? 'Hermes' : ctx.activeExecution.worker;
    const statusLabel = ctx.activeExecution.status.replace(/_/g, ' ').toLowerCase();
    const action = ctx.activeExecution.currentAction ? ` — ${ctx.activeExecution.currentAction}` : '';
    const llm = ctx.activeExecution.provider
      ? ` (${ctx.activeExecution.provider}${ctx.activeExecution.model ? ` / ${ctx.activeExecution.model}` : ''})`
      : '';
    parts.push(`${workerLabel} is currently ${statusLabel}${action}${llm}.`);
  } else if (ctx.runningCount > 0) {
    parts.push(`${ctx.runningCount} background task${ctx.runningCount === 1 ? ' is' : 's are'} running.`);
  } else if (ctx.queuedCount > 0) {
    parts.push(`${ctx.queuedCount} task${ctx.queuedCount === 1 ? ' is' : 's are'} queued.`);
  }

  if (ctx.pendingApproval) {
    parts.push(`Waiting on your approval for "${ctx.pendingApproval.title}".`);
  }

  if (ctx.latestFailure) {
    parts.push(`The most recent failure was "${ctx.latestFailure.title}" (${ctx.latestFailure.status}).`);
  }

  if (ctx.latestCompletedTask) {
    parts.push(`The last completed task was "${ctx.latestCompletedTask.title}"${ctx.latestCompletedTask.worker ? ` by ${ctx.latestCompletedTask.worker}` : ''}.`);
  } else if (ctx.latestHermesRun) {
    parts.push(`Hermes' latest run was "${ctx.latestHermesRun.title}" (${ctx.latestHermesRun.status}).`);
  } else if (ctx.latestCodeXRun) {
    parts.push(`CodeX's latest run was "${ctx.latestCodeXRun.title}" (${ctx.latestCodeXRun.status}).`);
  }

  if (ctx.nextPlannedAction) {
    parts.push(`Next scheduled action: "${ctx.nextPlannedAction.title}"${ctx.nextPlannedAction.nextRunAt ? ` at ${new Date(ctx.nextPlannedAction.nextRunAt).toLocaleString()}` : ''}.`);
  }

  if (parts.length === 0) {
    return "I can't determine the current task — there's no active project, execution, or background work in AgenticOS right now.";
  }

  return parts.join(' ');
}
