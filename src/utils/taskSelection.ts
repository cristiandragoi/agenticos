/**
 * Active Task selection policy for the Jarvis command center.
 *
 * The Active Task panel must select tasks in this order:
 *   1. the task created by the CURRENT user operation (operationId match)
 *   2. an active non-terminal task (queued / running / waiting_approval /
 *      paused / review)
 *   3. the most recent task by createdAt
 *
 * Terminal statuses (completed / failed / cancelled / BLOCKED) are NEVER
 * "current" — a historical blocked task can never override a newer task and
 * must stay labeled HISTORICAL.
 */
export type SelectionTask = {
  taskId: string;
  status: string;
  createdAt: string;
  metadata?: { operationId?: string } | Record<string, unknown> | null;
};

export const TASK_TERMINAL_STATUS: ReadonlySet<string> = new Set([
  'completed',
  'failed',
  'cancelled',
  'blocked',
]);

/**
 * Pick the task the Active Task panel should show.
 * `pinnedTaskId` — a task the user manually selected to inspect. It is kept
 * ONLY while it is still the policy winner (or while nothing newer/active
 * exists that would override per the policy).
 */
export function pickActiveTask(
  tasks: SelectionTask[],
  currentOperationId: string | null,
  pinnedTaskId: string | null
): string | null {
  if (!tasks.length) return null;
  const rank = (t: SelectionTask): number => {
    const opId =
      t.metadata && typeof t.metadata === 'object' && 'operationId' in t.metadata
        ? (t.metadata as { operationId?: unknown }).operationId
        : undefined;
    if (currentOperationId && typeof opId === 'string' && opId === currentOperationId) return 0;
    if (!TASK_TERMINAL_STATUS.has(t.status)) return 1;
    return 2;
  };
  const best = [...tasks].sort(
    (a, b) => rank(a) - rank(b) || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )[0];
  if (!best) return null;
  if (pinnedTaskId) {
    const pinned = tasks.find((t) => t.taskId === pinnedTaskId);
    if (pinned) {
      // Current-turn ownership: the current-operation task always wins over a
      // manually pinned historical task.
      if (rank(best) === 0 && rank(pinned) > 0) return best.taskId;
      // Otherwise a pinned task stays while it remains top-ranked (ties keep
      // the pin so a click to inspect a task isn't stolen by the poller).
      if (rank(pinned) <= rank(best)) return pinnedTaskId;
    }
  }
  return best.taskId;
}
