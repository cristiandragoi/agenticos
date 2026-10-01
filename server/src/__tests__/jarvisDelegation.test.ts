/**
 * jarvisDelegation.test.ts — PHASE F: real delegation.
 *
 * The contract under test is the CLAIM GATE: no worker-related user-facing
 * claim without evidence. Evidence means a real BackgroundTaskRecord whose
 * status is active/queued for the project, and the worker recorded on it.
 *
 * Tests D/E/F exercise the real task state model (BackgroundTaskManager);
 * A/B/C/I/J check that what Jarvis SAYS cannot outrun that state.
 */
import { describe, it, expect } from 'vitest';
import { backgroundTaskManager } from '../services/backgroundTasks/manager.js';
import { backgroundTaskRepo } from '../services/backgroundTasks/store.js';
import { isActiveStatus, isExecutingStatus } from '../services/backgroundTasks/types.js';
import { renderOperationalResult, workerLabel } from '../domains/jarvisNext/resultRenderer.js';
import { universalExecutionController } from '../domains/jarvis/execution/universalExecutionController.js';

const TEST_PROJECT = 'proj-phasef-test';

function newTask(title: string, worker: any = 'codex', projectId = TEST_PROJECT) {
  const res = backgroundTaskManager.createTask({
    title,
    objective: `Phase F test task: ${title}`,
    originalRequest: 'phase-f-test',
    route: 'codex',
    selectedAgent: worker,
    worker,
    projectId,
    resumable: false,
  });
  if (!res.task) throw new Error(`createTask failed: ${res.error}`);
  return res.task;
}

/** Claims that must never appear without a backing task record. */
const CLAIM_PATTERNS = [
  /\bassigned\b[^.]*\bto\s+(codex|hermes|the revenue operator|a worker)/i,
  /\b(task|tasks)\s+(is|are)\s+running\b/i,
  /\bi(?:'ve|\s+have)\s+(started|queued)\b/i,
];

describe('Phase F — real delegation state model', () => {
  it('D: a created task is QUEUED (not active) until a worker actually starts it', () => {
    const t = newTask('D: queued-not-active');
    const stored = backgroundTaskRepo.getTask(t.taskId)!;
    expect(stored.status).toBe('queued');
    expect(isExecutingStatus(stored.status)).toBe(false); // queued is NOT active
    expect(isActiveStatus(stored.status)).toBe(true);
  });

  it('E: starting a task makes it active, and completion persists the result', () => {
    const t = newTask('E: start-then-complete');
    const started = backgroundTaskManager.startTask(t.taskId);
    expect(started.ok).toBe(true);
    expect(isExecutingStatus(backgroundTaskRepo.getTask(t.taskId)!.status)).toBe(true);

    backgroundTaskManager.transition(t.taskId, 'completed', { resultText: 'Phase F result persisted.' });
    const done = backgroundTaskRepo.getTask(t.taskId)!;
    expect(done.status).toBe('completed');
    expect(done.completedAt).toBeTruthy();
    expect(done.resultText).toBe('Phase F result persisted.');
  });

  it('F: a failure persists its reason', () => {
    const t = newTask('F: failure-reason');
    backgroundTaskManager.startTask(t.taskId);
    backgroundTaskManager.transition(t.taskId, 'failed', { lastError: 'compile error in widget.ts' });
    const failed = backgroundTaskRepo.getTask(t.taskId)!;
    expect(failed.status).toBe('failed');
    expect(failed.lastError).toMatch(/compile error/);
  });

  it('terminal states are immutable (a late worker event cannot revive a task)', () => {
    const t = newTask('F2: terminal-immutable');
    backgroundTaskManager.transition(t.taskId, 'failed', { lastError: 'boom' });
    backgroundTaskManager.transition(t.taskId, 'running', { lastError: null });
    expect(backgroundTaskRepo.getTask(t.taskId)!.status).toBe('failed');
  });

  it('a blocked task is not active and carries its blocker', () => {
    const t = newTask('C: blocked-credentials');
    backgroundTaskManager.blockTask(t.taskId, 'Missing external FreeCash API keys / credentials');
    const blocked = backgroundTaskRepo.getTask(t.taskId)!;
    expect(blocked.status).toBe('blocked');
    expect(isExecutingStatus(blocked.status)).toBe(false);
    expect(blocked.blocker).toMatch(/credentials/i);
  });
});

describe('Phase F — claim gate (no claim without evidence)', () => {
  it('A: any assignment Jarvis claims for Free Cash is backed by a real task record', async () => {
    const res = await universalExecutionController.handleUserTurn({
      prompt: 'Jarvis, start working on Free Cash.',
      conversationId: `phasef-A-${Date.now()}`,
      sttConfidence: 1.0,
      rawStt: 'Jarvis, start working on Free Cash.',
    });
    const said = `${res.spokenText || ''} ${res.plan?.goalDescription || ''}`;
    const claims = CLAIM_PATTERNS.some((p) => p.test(said));

    if (claims) {
      // The claim must be backed: an active/queued task must exist for the project.
      const tasks = backgroundTaskManager.listTasks({ projectId: 'proj-free-cash', limit: 100 });
      const backing = tasks.filter((t) => isActiveStatus(t.status));
      expect(backing.length, `claimed "${said}" with no active/queued task record`).toBeGreaterThan(0);
      expect(backing.some((t) => Boolean(t.worker))).toBe(true);
    }
    // The bare template that started this whole phase must be gone.
    expect(said.trim()).not.toBe('Started.');
    expect(said).not.toMatch(/\bStarted\.\s*$/);
  });

  it('B/C: with nothing running or queued, no worker activity may be claimed', async () => {
    const blocked = await renderOperationalResult({
      kind: 'project_operate',
      entityName: 'Free Cash',
      runningTasks: 0,
      queuedTasks: 0,
      blockedTasks: 2,
      blocker: 'Missing external FreeCash API keys / credentials',
      blockerRecordedAt: '2026-09-11T00:00:00.000Z',
      success: false,
      verified: false,
    });
    expect(blocked).not.toMatch(/assigned .* to /i);
    expect(blocked).not.toMatch(/is running now/i);
    expect(blocked).not.toMatch(/\bStarted\b/i);
    expect(blocked).toMatch(/could not start work/i);
  });

  it('J: an assignment is only spoken when a worker label can be derived', async () => {
    const noWorker = await renderOperationalResult({
      kind: 'project_operate', entityName: 'Free Cash', runningTasks: 1, queuedTasks: 0, blockedTasks: 0,
      success: true, verified: true,
    });
    expect(noWorker).not.toMatch(/assigned/i);

    const withWorker = await renderOperationalResult({
      kind: 'project_operate', entityName: 'Free Cash', runningTasks: 1, queuedTasks: 0, blockedTasks: 0,
      worker: 'codex', taskTitle: 'Revenue Operator: Free Cash Mission', success: true, verified: true,
    });
    expect(withWorker).toMatch(/assigned/i);
    expect(withWorker).toMatch(/codex/i);
  });

  it('I: project-scoped worker state is available for a real answer', () => {
    const t = newTask('I: codex-running', 'codex');
    backgroundTaskManager.startTask(t.taskId);
    const scoped = backgroundTaskManager.listTasks({ projectId: TEST_PROJECT, limit: 50 });
    const running = scoped.filter((x) => isExecutingStatus(x.status));
    expect(running.length).toBeGreaterThan(0);
    expect(workerLabel(running[0].worker)).toBe('Codex');
    expect(running[0].title).toBe('I: codex-running');
  });
});
