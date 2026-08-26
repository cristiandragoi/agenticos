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
/** Semantic detection — recognizes the QUESTION FAMILY, not exact phrases. */
const CURRENT_WORK_PATTERNS = [
    /\b(what|which)\b.*\b(current(ly)?|right now|at the moment|now)\b.*\b(work(ing)?|task|project|milestone|focus|doing|on)\b/i,
    /\bwhat\b.*\b(are we|we're|are you|am i|i am)\b.*\b(working|doing|on)\b/i,
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
    /\bwhich\b.*\b(task|project|work|milestone|item)\b.*\b(on|right now|now|currently|active|current)\b/i,
];
/** Question-family detector — true for any current-work phrasing. */
export function isCurrentWorkQuestion(text) {
    const t = (text || '').trim();
    if (!t)
        return false;
    // Explicitly exclude identity questions that must keep the fast-path
    // (already handled by fastLocalReplies) — never hijack them.
    if (/\bwhat is (jarvis|agentic os)\b/i.test(t))
        return false;
    // "what are YOU doing" is the execution-status cue (handled by the
    // execution-aware control path, which reports the live operation record).
    // Current-work questions ask about WE/the project/tasks — never hijack.
    if (/\bwhat are you doing\b/i.test(t))
        return false;
    // Explicit execution/action clause wins over a current-work question. A
    // prompt that BOTH asks about state AND requests work ("what's broken? fix
    // it", "what next? have Hermes plan and CodeX execute it") must route to
    // worker execution — never a status-only current-work answer.
    if (hasActionClause(t))
        return false;
    return CURRENT_WORK_PATTERNS.some((re) => re.test(t));
}
/**
 * Explicit execution/action clause detector. True when the prompt contains an
 * imperative work request (fix/implement/build/execute/delegate/…, a worker
 * delegation cue "have/ask/tell Hermes|CodeX", a compound "inspect … and fix",
 * or "continue <work>"). These must take precedence over a current-work
 * context question so action requests are not swallowed into a status answer.
 */
export function hasActionClause(text) {
    const t = (text || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (!t)
        return false;
    return ACTION_CLAUSE_RE.test(t);
}
const ACTION_CLAUSE_RE = new RegExp([
    // Imperative action verbs — explicit work request.
    '\\b(fix|implement|build|execute|delegate|deploy|proceed|create|run|test|refactor|modify|write|add|remove)\\b',
    // Worker delegation cue: "have/ask/tell/get/make Hermes|CodeX …".
    '\\b(have|ask|tell|get|make|instruct)\\s+(hermes|codex)\\b',
    // Compound "inspect/find/check … and fix/implement/…".
    '\\b(inspect|find|check|analy[sz]e|look into|investigate)\\b[^.!?\\n]{0,60}\\b(fix|repair|resolve|solve|correct|implement|build|write|add)\\b',
    // "continue <work>" / "continue the implementation".
    '\\bcontinue\\b\\s*(the\\s+)?(working|implementing|building|developing|fixing|implementation|work|development)\\b',
].join('|'), 'i');
/** Resolve the structured current-work context from real AgenticOS state. */
export async function resolveCurrentWorkContext() {
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
    const latestCompletedOp = history.find((r) => r.status === 'COMPLETED');
    const latestFailedOp = history.find((r) => r.status === 'FAILED');
    // Background tasks by interest class (newest first when the repo orders by
    // updatedAt desc — otherwise fall back to array order).
    const byWorker = (w) => tasks.filter((t) => t.worker === w);
    const hermesTasks = byWorker('hermes');
    const codexTasks = byWorker('codex');
    const latestHermesRun = hermesTasks[0] ?? null;
    const latestCodeXRun = codexTasks[0] ?? null;
    const latestCompletedTask = [...tasks].reverse().find((t) => t.status === 'completed') ?? null;
    const pendingApproval = tasks.find((t) => t.status === 'waiting_approval') ?? null;
    const latestFailure = [...tasks].reverse().find((t) => t.status === 'failed' || t.status === 'blocked') ?? null;
    const queuedCount = tasks.filter((t) => t.status === 'queued').length;
    const runningCount = tasks.filter((t) => t.status === 'running' || t.status === 'verifying').length;
    // Next scheduled worker-task run (the scheduler bridge dispatches real
    // worker tasks; legacy_skill schedules are SIMULATED and excluded).
    let nextPlannedAction = null;
    try {
        const rows = await db.select().from(schedules);
        const next = (Array.isArray(rows) ? rows : [])
            .filter((s) => s?.active !== false && s?.executionType === 'worker_task' && s?.nextRunAt)
            .sort((a, b) => new Date(a.nextRunAt).getTime() - new Date(b.nextRunAt).getTime())[0] ?? null;
        if (next) {
            nextPlannedAction = { title: next.taskTitle ?? next.name ?? next.taskId ?? 'scheduled task', nextRunAt: next.nextRunAt ?? null };
        }
    }
    catch { /* schedules may not exist in dev DB — best effort */ }
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
export function formatCurrentWorkContext(ctx) {
    const parts = [];
    if (ctx.activeProject) {
        parts.push(`Your active project is "${ctx.activeProject.name}".`);
    }
    if (ctx.activeExecution) {
        const workerLabel = ctx.activeExecution.worker === 'jarvis' ? 'Jarvis' :
            ctx.activeExecution.worker === 'codex' ? 'CodeX' :
                ctx.activeExecution.worker === 'hermes' ? 'Hermes' : ctx.activeExecution.worker;
        const statusLabel = ctx.activeExecution.status.replace(/_/g, ' ').toLowerCase();
        const action = ctx.activeExecution.currentAction ? ` — ${ctx.activeExecution.currentAction}` : '';
        const llm = ctx.activeExecution.provider
            ? ` (${ctx.activeExecution.provider}${ctx.activeExecution.model ? ` / ${ctx.activeExecution.model}` : ''})`
            : '';
        parts.push(`${workerLabel} is currently ${statusLabel}${action}${llm}.`);
    }
    else if (ctx.runningCount > 0) {
        parts.push(`${ctx.runningCount} background task${ctx.runningCount === 1 ? ' is' : 's are'} running.`);
    }
    else if (ctx.queuedCount > 0) {
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
    }
    else if (ctx.latestHermesRun) {
        parts.push(`Hermes' latest run was "${ctx.latestHermesRun.title}" (${ctx.latestHermesRun.status}).`);
    }
    else if (ctx.latestCodeXRun) {
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
