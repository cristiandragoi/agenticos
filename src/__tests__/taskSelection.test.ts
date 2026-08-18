import { describe, expect, it } from 'vitest';
import { pickActiveTask, TASK_TERMINAL_STATUS } from '../utils/taskSelection';

const t = (taskId: string, status: string, createdAt: string, operationId?: string) => ({
  taskId,
  status,
  createdAt,
  metadata: operationId ? { operationId } : {},
});

describe('Active Task selection policy', () => {
  it('selects the task created by the current operationId first', () => {
    const tasks = [
      t('bgtask-old', 'blocked', '2026-08-07T07:50:00Z'),
      t('bgtask-new', 'queued', '2026-08-07T07:57:00Z', 'op-current'),
    ];
    expect(pickActiveTask(tasks, 'op-current', null)).toBe('bgtask-new');
  });

  it('a historical blocked task never overrides a newly created task', () => {
    const tasks = [
      t('bgtask-old', 'blocked', '2026-08-07T07:50:00Z', 'op-old'),
      t('bgtask-new', 'queued', '2026-08-07T07:57:00Z', 'op-current'),
    ];
    // Even when the user had pinned the old blocked task, the current-op task wins.
    expect(pickActiveTask(tasks, 'op-current', 'bgtask-old')).toBe('bgtask-new');
  });

  it('selects an active non-terminal task over a most-recent blocked/completed task', () => {
    const tasks = [
      t('bgtask-blocked', 'blocked', '2026-08-07T07:58:00Z'),
      t('bgtask-running', 'running', '2026-08-07T07:57:00Z'),
      t('bgtask-done', 'completed', '2026-08-07T07:55:00Z'),
    ];
    expect(pickActiveTask(tasks, null, null)).toBe('bgtask-running');
  });

  it('blocked is terminal: never picked when any active task exists, but remains viewable when it is the only task', () => {
    expect(TASK_TERMINAL_STATUS.has('blocked')).toBe(true);
    const onlyBlocked = [t('bgtask-old', 'blocked', '2026-08-07T07:50:00Z')];
    expect(pickActiveTask(onlyBlocked, null, null)).toBe('bgtask-old'); // historical remains viewable
  });

  it('falls back to the most recent terminal task only when nothing active exists', () => {
    const tasks = [
      t('bgtask-old-blocked', 'blocked', '2026-08-07T07:46:00Z'),
      t('bgtask-new-blocked', 'blocked', '2026-08-07T07:53:00Z'),
    ];
    expect(pickActiveTask(tasks, null, null)).toBe('bgtask-new-blocked');
  });

  it('a pinned active task is kept on ties (manual inspection is not stolen by the poller)', () => {
    const tasks = [
      t('bgtask-a', 'running', '2026-08-07T07:50:00Z'),
      t('bgtask-b', 'running', '2026-08-07T07:57:00Z'),
    ];
    expect(pickActiveTask(tasks, null, 'bgtask-a')).toBe('bgtask-a');
  });

  it('direct status questions during a revenue run never replace the active task selection', () => {
    // No new task is created for a status question, so the summary is
    // unchanged and the active revenue task stays selected.
    const tasks = [
      t('bgtask-revenue', 'running', '2026-08-07T07:57:00Z', 'op-rev'),
    ];
    expect(pickActiveTask(tasks, 'op-rev', null)).toBe('bgtask-revenue');
    // A stale SSE event from an older task cannot re-select it: the panel
    // only ever evaluates the CURRENT summary + current operationId.
    expect(pickActiveTask(tasks, 'op-rev', 'bgtask-old-ghost')).toBe('bgtask-revenue');
  });
});
