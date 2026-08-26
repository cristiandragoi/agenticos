/**
 * Canonical Background Task contract (Milestone: Persistent Background Task Manager).
 *
 * One contract, one manager, one event vocabulary. Worker adapters (Hermes,
 * CodeX, Research, Agent Teams, Automation) translate worker-specific state
 * into this contract — the manager never contains provider-specific logic.
 */
/** Terminal states are immutable — late worker events can never revive them. */
export const TERMINAL_STATUSES = new Set([
    'completed',
    'failed',
    'cancelled',
]);
export const TASK_LIMITS = {
    /** Conservative defaults — overridable via env BG_TASK_MAX_* (not exposed in UI yet). */
    maxActiveGlobal: Number(process.env.BG_TASK_MAX_ACTIVE ?? 3),
    maxActiveHermes: Number(process.env.BG_TASK_MAX_HERMES ?? 1),
    maxActiveCodex: Number(process.env.BG_TASK_MAX_CODEX ?? 1),
    maxActiveTeam: Number(process.env.BG_TASK_MAX_TEAM ?? 1),
    maxQueued: Number(process.env.BG_TASK_MAX_QUEUED ?? 10),
};
export function isActiveStatus(s) {
    return s === 'queued' || s === 'planning' || s === 'running' || s === 'verifying' || s === 'waiting_approval' || s === 'review';
}
export function taskShortId(taskId) {
    const m = taskId.match(/-(\w+)$/);
    return m ? `T-${m[1].slice(0, 6).toUpperCase()}` : taskId;
}
