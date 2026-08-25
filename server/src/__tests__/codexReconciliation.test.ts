/**
 * CodeX task-terminal reconciliation regression tests (milestone: a CodeX
 * goal's terminal state must never strand its parent background task in the
 * non-terminal 'review' state).
 *
 * Covers: completed+PASS → completed, completed+FAIL → failed (truthful),
 * failed goal → recovery, duplicate reconciliation → idempotent, and a task
 * already stranded in 'review' → recovered to terminal.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'node:path';
import os from 'node:os';

vi.setConfig({ hookTimeout: 60000, testTimeout: 30000 });

let tmpDir: string;
let mgr: any;
let repo: any;
let adapters: any;
let goalStore: any;

async function freshModules() {
  vi.resetModules();
  const managerMod = await import('../services/backgroundTasks/manager.js');
  const storeMod = await import('../services/backgroundTasks/store.js');
  const adaptersMod = await import('../services/backgroundTasks/adapters.js');
  const goalStoreMod = await import('../services/goalStore.js');
  return {
    mgr: managerMod.backgroundTaskManager,
    repo: storeMod.backgroundTaskRepo,
    adapters: adaptersMod,
    goalStore: goalStoreMod.goalStore,
  };
}

function seedGoal(id: string, status: string, runSummary: any) {
  goalStore.create({
    id,
    originalGoal: 'test goal',
    status,
    retryCount: 0,
    providerFallbackCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    workspacePath: tmpDir,
  } as any);
  if (runSummary) {
    goalStore.update(id, { status, runSummary } as any);
  }
}

function seedCodexTask(goalId: string, status = 'running') {
  const { task } = mgr.createTask({
    title: 'CodeX regression',
    objective: 'edit a file and run the test',
    originalRequest: 'edit a file and run the test',
    route: 'codex',
    selectedAgent: 'CodeX',
    worker: 'codex',
  });
  mgr.transition(task.taskId, status);
  repo.updateTask(task.taskId, { linkedRunId: goalId, worker: 'codex' });
  return task.taskId;
}

describe('CodeX task-terminal reconciliation', () => {
  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codexrec-'));
    process.env.AGENT_TEAMS_DB_PATH = path.join(tmpDir, 'test.db');
    ({ mgr, repo, adapters, goalStore } = await freshModules());
  });
  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('completed+PASS goal reconciles the task to completed (never review)', () => {
    const goalId = 'goal-pass';
    seedGoal(goalId, 'completed', { finalAnswer: 'All 2 tests passed.' });
    const taskId = seedCodexTask(goalId, 'running');
    adapters.reconcileCodexTasksAfterRestart();
    const t = repo.getTask(taskId);
    expect(t.status).toBe('completed');
    expect(t.verificationState).toBe('passed');
    expect(t.status).not.toBe('review');
  });

  it('completed+FAIL goal fails the task truthfully (terminal, not review)', () => {
    const goalId = 'goal-fail';
    seedGoal(goalId, 'completed', { finalAnswer: 'Ran the suite: 2 of 3 tests failed.' });
    const taskId = seedCodexTask(goalId, 'running');
    adapters.reconcileCodexTasksAfterRestart();
    const t = repo.getTask(taskId);
    expect(t.status).toBe('failed');
    expect(t.testState).toBe('failed');
    expect(t.verificationState).toBe('failed');
    expect(t.status).not.toBe('review');
  });

  it('failed goal routes through recovery (never left in review)', () => {
    const goalId = 'goal-broken';
    seedGoal(goalId, 'failed', null);
    const taskId = seedCodexTask(goalId, 'running');
    const spy = vi.spyOn(mgr, 'recoverAfterFailure').mockResolvedValue(null);
    adapters.reconcileCodexTasksAfterRestart();
    expect(spy).toHaveBeenCalledWith(taskId, expect.any(String));
    spy.mockRestore();
  });

  it('duplicate reconciliation is idempotent (single verified event)', () => {
    const goalId = 'goal-dup';
    seedGoal(goalId, 'completed', { finalAnswer: 'All tests passed.' });
    const taskId = seedCodexTask(goalId, 'running');
    adapters.reconcileCodexTasksAfterRestart();
    expect(repo.getTask(taskId).status).toBe('completed');
    const first = repo.getEvents(taskId).filter((e: any) => e.kind === 'task.verified').length;
    adapters.reconcileCodexTasksAfterRestart();
    expect(repo.getTask(taskId).status).toBe('completed');
    const second = repo.getEvents(taskId).filter((e: any) => e.kind === 'task.verified').length;
    expect(second).toBe(first);
  });

  it('a task already stranded in review is recovered to completed', () => {
    const goalId = 'goal-review';
    seedGoal(goalId, 'completed', { finalAnswer: 'All tests passed.' });
    const taskId = seedCodexTask(goalId, 'running');
    // Simulate the historical defect: the task was left in non-terminal review.
    repo.updateTask(taskId, { status: 'review', verificationState: 'failed' });
    adapters.reconcileCodexTasksAfterRestart();
    const t = repo.getTask(taskId);
    expect(t.status).toBe('completed');
    expect(t.status).not.toBe('review');
  });
});

describe('codexGoalReportedFailure (pure verdict classifier)', () => {
  it('classifies pass, fail, mixed, and empty verdicts by headline', () => {
    expect(adapters.codexGoalReportedFailure({ runSummary: { finalAnswer: 'All 2 tests passed.' } })).toBe(false);
    expect(adapters.codexGoalReportedFailure({ runSummary: { finalAnswer: '2 of 3 tests failed.' } })).toBe(true);
    expect(adapters.codexGoalReportedFailure({ runSummary: { finalAnswer: 'build failed' } })).toBe(true);
    // Mixed report: a headline pass overrides an incidental FAIL mention.
    expect(adapters.codexGoalReportedFailure({ runSummary: { finalAnswer: 'Found a bug (FAIL), fixed it, re-ran: all tests passed.' } })).toBe(false);
    expect(adapters.codexGoalReportedFailure({})).toBe(false);
  });

  it('goalStateToTaskStatus maps terminal and non-terminal goal states', () => {
    expect(adapters.goalStateToTaskStatus('completed')).toBe('completed');
    expect(adapters.goalStateToTaskStatus('failed')).toBe('failed');
    expect(adapters.goalStateToTaskStatus('stopped')).toBe('cancelled');
    expect(adapters.goalStateToTaskStatus('executing')).toBe('running');
  });
});
