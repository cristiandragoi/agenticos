/**
 * Task-control intent classification (Milestone requirement 8).
 *
 * Explicit task-control language overrides normal direct-chat classification.
 * A normal conversation message NEVER touches task state — only these
 * explicit commands do.
 *
 * Phase 6 fix: a control verb must ADJACENTLY govern "task" and (for mutating
 * commands) either carry a real identifier or be a short, unambiguous command.
 * Ordinary engineering prose ("...parent task after restart...") is NEVER
 * task control, and identifiers are only extracted from ID-shaped tokens
 * (never loose "t-" fragments like "t-restart").
 */
import { backgroundTaskManager } from './manager.js';
import { taskShortId } from './types.js';
/**
 * Canonical identifier shapes — word-bounded and ID-shaped so ordinary prose
 * can never donate a fabricated id.
 *
 *  - `T-ABC123` / `t-ABC123`            : short task id (taskShortId emits `T-` + uppercase)
 *  - `bgtask-…`, `pt-…`, `task-…`, `goal-…`, `run-…`, `er-…`, `exr-…`, `ver-…`
 *                                        : full ids (all seen across the canonical DB)
 *
 * The suffix must contain at least one digit, which excludes hyphenated English
 * words like "task-force", "goal-post", "run-time" while still matching real ids
 * (`goal-456`, `pt-e80a87e3`, `bgtask-1a2b3c`).
 */
const TASK_REF_RE = /\b([Tt]-[A-Z0-9]{3,}|(?:bgtask|pt|task|goal|run|er|exr|ver)-[a-z0-9-]*\d[a-z0-9-]*)\b/;
/**
 * A control verb must directly govern "task"/"tasks" (optionally via a single
 * determiner): "resume task", "stop the task", "cancel my task". It must NOT
 * merely co-occur with the word "task" somewhere else in the sentence.
 */
const VERB_ADJ_TASK_RE = /\b(pause|suspend|resume|continue|restart|stop|halt|abort|cancel|retry|approve|deny|reject)\s+(?:the\s+|my\s+|a\s+|an\s+)?tasks?(?![-\w])/i;
function extractTaskRef(prompt) {
    const m = prompt.match(TASK_REF_RE);
    return m ? m[1] : '';
}
export function classifyTaskControl(prompt) {
    const p = prompt.toLowerCase().replace(/\s+/g, ' ').trim();
    const taskRef = extractTaskRef(prompt);
    const isShort = p.split(/\s+/).length <= 6;
    // A control verb only counts when it ADJACENTLY governs "task".
    const verbAdj = p.match(VERB_ADJ_TASK_RE);
    if (verbAdj) {
        const verb = verbAdj[1];
        // Mutating commands without an explicit id are only honored when short and
        // unambiguous ("resume task", "pause task"). A long message that merely
        // mentions a control verb and "task" is a NEW instruction, not control.
        const mutatingAllowed = !!taskRef || isShort;
        if (mutatingAllowed) {
            if (verb === 'pause' || verb === 'suspend')
                return { type: 'pause_task', taskRef };
            if (verb === 'resume' || verb === 'continue' || verb === 'restart')
                return { type: 'resume_task', taskRef };
            if (verb === 'stop' || verb === 'halt' || verb === 'abort')
                return { type: 'stop_task', taskRef };
            if (verb === 'cancel')
                return { type: 'cancel_task', taskRef };
            if (verb === 'retry')
                return { type: 'retry_task', taskRef };
            if (verb === 'approve')
                return { type: 'approve_task', taskRef, choice: 'allow' };
            if (verb === 'deny' || verb === 'reject')
                return { type: 'approve_task', taskRef, choice: 'deny' };
        }
    }
    // Agent status queries — "what is Hermes doing" / "what is CodeX doing".
    const agentMatch = p.match(/\bwhat is (hermes|codex|jarvis|the team) doing\b/);
    if (agentMatch) {
        return { type: 'agent_status', agent: agentMatch[1] };
    }
    // Single-task inspection FIRST — "show task T-104" / "status of task X" /
    // "what happened to goal-456".
    if (taskRef && /\b(show|status|progress|inspect|what happened to|tell me about)\b/.test(p)) {
        return { type: 'show_task', taskRef };
    }
    if (/\bprogress of\b/.test(p) && taskRef) {
        return { type: 'show_task', taskRef };
    }
    // Task listing queries.
    if (/\bshow (me )?(active|running|current) tasks?\b/.test(p) || /\bshow active\b/.test(p)) {
        return { type: 'list_tasks', scope: 'active' };
    }
    if (/\bshow (me )?blocked tasks?\b/.test(p)) {
        return { type: 'list_tasks', scope: 'blocked' };
    }
    if (/\bshow (me )?(queued|pending) tasks?\b/.test(p)) {
        return { type: 'list_tasks', scope: 'queued' };
    }
    if (/\b(show|list) (all )?(my )?tasks?\b/.test(p) || /\bwhat tasks? (are|is)\b/.test(p)) {
        return { type: 'list_tasks', scope: 'all' };
    }
    // Board navigation.
    if (/\bopen (the )?(task )?board\b/.test(p)) {
        return { type: 'open_board' };
    }
    return null;
}
/** Build a human-readable task summary line for Jarvis replies. */
export function formatTaskLine(task) {
    const elapsed = task.startedAt
        ? ` · ${formatElapsed(Date.now() - new Date(task.startedAt).getTime())}`
        : '';
    const extra = task.blocker ? ` — ${task.blocker}` : task.progressMessage ? ` — ${task.progressMessage}` : '';
    return `${taskShortId(task.taskId)} [${task.status}] ${task.title} (${task.worker})${elapsed}${extra}`;
}
function formatElapsed(ms) {
    const s = Math.floor(ms / 1000);
    if (s < 60)
        return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60)
        return `${m}m ${s % 60}s`;
    return `${Math.floor(m / 60)}h ${m % 60}m`;
}
/** Execute a classified task-control intent. Returns the Jarvis reply text (or null if unhandled). */
export async function executeTaskControl(intent) {
    const mgr = backgroundTaskManager;
    switch (intent.type) {
        case 'list_tasks': {
            const tasks = intent.scope === 'active'
                ? mgr.listTasks({ activeOnly: true })
                : intent.scope === 'blocked'
                    ? mgr.listTasks({ status: ['blocked', 'failed'] })
                    : intent.scope === 'queued'
                        ? mgr.listTasks({ status: ['queued'] })
                        : mgr.listTasks({ limit: 20 });
            if (!tasks.length)
                return `No ${intent.scope === 'all' ? '' : intent.scope + ' '}tasks right now.`;
            return `${tasks.length} ${intent.scope === 'all' ? '' : intent.scope + ' '}task${tasks.length > 1 ? 's' : ''}:\n${tasks.map(formatTaskLine).join('\n')}`;
        }
        case 'show_task': {
            if (!intent.taskRef)
                return 'Which task? Say the task id, e.g. "show task T-ABC123".';
            const task = mgr.resolveTaskRef(intent.taskRef);
            if (!task)
                return `I could not find task ${intent.taskRef}.`;
            const events = mgr.getEvents(task.taskId).slice(-5);
            const recent = events.length ? `\nRecent events:\n${events.map(e => `  · ${e.kind}: ${e.summary}`).join('\n')}` : '';
            return `${formatTaskLine(task)}${recent}`;
        }
        case 'pause_task': {
            const task = intent.taskRef ? mgr.resolveTaskRef(intent.taskRef) : mgr.listTasks({ activeOnly: true })[0];
            if (!task)
                return intent.taskRef ? `I could not find task ${intent.taskRef}.` : 'There is no active task to pause.';
            const result = await mgr.pauseTask(task.taskId);
            return result.ok
                ? `${taskShortId(task.taskId)} paused.`
                : result.error || 'Pause failed.';
        }
        case 'resume_task': {
            const task = intent.taskRef ? mgr.resolveTaskRef(intent.taskRef) : mgr.listTasks({ status: ['paused', 'blocked'] })[0];
            if (!task)
                return intent.taskRef ? `I could not find task ${intent.taskRef}.` : 'There is no paused task to resume.';
            const result = await mgr.resumeTask(task.taskId);
            return result.ok
                ? `${taskShortId(task.taskId)} resumed.`
                : result.error || 'Resume failed.';
        }
        case 'stop_task': {
            const task = intent.taskRef ? mgr.resolveTaskRef(intent.taskRef) : mgr.listTasks({ activeOnly: true })[0];
            if (!task)
                return intent.taskRef ? `I could not find task ${intent.taskRef}.` : 'There is no active task to stop.';
            const result = await mgr.stopTask(task.taskId);
            return result.ok ? `Stop requested for ${taskShortId(task.taskId)}.` : result.error || 'Stop failed.';
        }
        case 'cancel_task': {
            const task = intent.taskRef ? mgr.resolveTaskRef(intent.taskRef) : mgr.listTasks({ activeOnly: true })[0];
            if (!task)
                return intent.taskRef ? `I could not find task ${intent.taskRef}.` : 'There is no task to cancel.';
            const result = mgr.cancelTask(task.taskId);
            return result.ok ? `${taskShortId(task.taskId)} cancelled.` : result.error || 'Cancel failed.';
        }
        case 'retry_task': {
            if (!intent.taskRef)
                return 'Which task should I retry? Say the task id.';
            const task = mgr.resolveTaskRef(intent.taskRef);
            if (!task)
                return `I could not find task ${intent.taskRef}.`;
            if (!['failed', 'blocked', 'cancelled'].includes(task.status)) {
                return `${taskShortId(task.taskId)} is ${task.status} — only failed, blocked, or cancelled tasks can retry.`;
            }
            // Retry rule (requirement 10): reuse the existing Board card, new run.
            const { task: newTask, error } = mgr.createTask({
                title: task.title,
                objective: task.objective,
                originalRequest: task.originalRequest,
                route: task.route,
                selectedAgent: task.selectedAgent,
                worker: task.worker,
                priority: task.priority,
                conversationId: task.conversationId,
                conversationSessionId: task.conversationSessionId,
                resumable: task.resumable,
                metadata: { ...task.metadata, retryOf: task.taskId },
                boardCardId: task.linkedBoardCardId,
            });
            if (!newTask)
                return error || 'Retry failed.';
            return `Retrying as ${taskShortId(newTask.taskId)} (new run, same Board card).`;
        }
        case 'approve_task': {
            const task = intent.taskRef ? mgr.resolveTaskRef(intent.taskRef) : mgr.listTasks({ status: ['waiting_approval'] })[0];
            if (!task)
                return 'There is no task waiting for approval.';
            if (task.status !== 'waiting_approval')
                return `${taskShortId(task.taskId)} is not waiting for approval (status: ${task.status}).`;
            // Approval resolution goes through the same endpoint path as the UI.
            const { hermesApiService } = await import('../hermesApiService.js');
            const { codexService } = await import('../../domains/codex/service.js');
            const result = await mgr.resolveApproval(task.taskId, intent.choice, async (c) => {
                if (task.worker === 'hermes' && task.linkedRunId) {
                    await hermesApiService.resolveApproval(task.linkedRunId, c);
                }
                else if ((task.worker === 'codex' || task.worker === 'team') && task.linkedRunId) {
                    if (c === 'allow')
                        await codexService.approveAndResume(task.linkedRunId);
                    else
                        await codexService.abortGoal(task.linkedRunId);
                }
            });
            return result.ok
                ? `Approval ${intent.choice === 'allow' ? 'allowed' : 'denied'} for ${taskShortId(task.taskId)}.`
                : result.error || 'Approval failed.';
        }
        case 'agent_status': {
            const agentMap = { hermes: 'hermes', codex: 'codex', jarvis: 'hermes', 'the team': 'team' };
            const worker = agentMap[intent.agent] || intent.agent;
            const tasks = mgr.listTasks({ activeOnly: true }).filter(t => t.worker === worker);
            if (!tasks.length)
                return `${intent.agent[0].toUpperCase() + intent.agent.slice(1)} has no active tasks right now.`;
            return `${intent.agent[0].toUpperCase() + intent.agent.slice(1)} is working on:\n${tasks.map(formatTaskLine).join('\n')}`;
        }
        case 'open_board':
            return 'Opening the task board. (Navigate to /boards to see all cards.)';
        default:
            return null;
    }
}
