/**
 * Focused tests — Persistent Background Task Manager.
 *
 * Covers: persistence, event stream, stale-result protection (Test F),
 * stop/cancel/pause semantics, approval persistence (Test E), retry board-card
 * reuse, restore-after-restart, concurrency limits, task-control intent
 * classification (normal conversation never touches tasks).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'node:path';
import os from 'node:os';

// This host is slow to boot the manager/gateway module chain inside
// freshModules(); give hooks headroom so environment slowness never reads as
// a test failure.
vi.setConfig({ hookTimeout: 60000, testTimeout: 30000 });

let tmpDir: string;
let mgr: any;
let repo: any;
let control: any;

async function freshModules() {
  // db/index.ts reads AGENT_TEAMS_DB_PATH at import — reset modules per test.
  vi.resetModules();
  const managerMod = await import('../services/backgroundTasks/manager.js');
  const storeMod = await import('../services/backgroundTasks/store.js');
  const controlMod = await import('../services/backgroundTasks/taskControl.js');
  return { manager: managerMod.backgroundTaskManager, repo: storeMod.backgroundTaskRepo, control: controlMod };
}

describe('Background Task Manager — persistence & events', () => {
  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bgtask-'));
    process.env.AGENT_TEAMS_DB_PATH = path.join(tmpDir, 'test.db');
    ({ manager: mgr, repo, control } = await freshModules());
  });
  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  const baseInput = {
    title: 'Inspect voice pipeline',
    objective: 'Inspect src/components/jarvis/JarvisCore.tsx. Do not modify files.',
    originalRequest: 'Ask Hermes to inspect the Jarvis voice pipeline.',
    route: 'hermes',
    selectedAgent: 'Hermes',
    worker: 'hermes' as const,
    conversationId: 'conv-1',
  };

  it('creates and persists a task with the full contract', () => {
    const { task } = mgr.createTask(baseInput);
    expect(task).toBeTruthy();
    expect(task.status).toBe('queued');
    expect(task.conversationId).toBe('conv-1');
    expect(task.childTaskIds).toEqual([]);
    expect(task.attempt).toBe(1);
    // Persisted outside React/component state — readable straight from the repo.
    const reloaded = repo.getTask(task.taskId);
    expect(reloaded.title).toBe('Inspect voice pipeline');
    expect(relinked(reloaded, task)).toBe(true);
  });

  it('appends persisted events with monotonic sequence', () => {
    const { task } = mgr.createTask(baseInput);
    mgr.appendEvent(task.taskId, 'task.progress', 'Hermes is planning.');
    mgr.appendEvent(task.taskId, 'task.progress', 'Hermes started.');
    const events = repo.getEvents(task.taskId);
    // created + queued (from createTask) + 2 progress
    expect(events.length).toBeGreaterThanOrEqual(4);
    const seqs = events.map((e: any) => e.sequence);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);
  });

  it('mirrors revenue lead counts from progress events onto the canonical execution record', async () => {
    const opId = 'op-mirror-test';
    const { task } = mgr.createTask({ ...baseInput, worker: 'revenue' as const, route: 'revenue_pipeline' as const, metadata: { operationId: opId } });
    const execMod = await import('../services/executionState.js');
    execMod.clearExecutions();
    execMod.begin({ operationId: opId, worker: 'revenue', status: 'RUNNING' });
    mgr.progress(task.taskId, 'task.progress', '10/10 candidates inspected, 8 qualified, 2 rejected (target 5).', {}, { discovered: 10, qualified: 8, rejected: 2, requested: 5 });
    const rec = execMod.getCurrent();
    expect(rec?.discoveredCount).toBe(10);
    expect(rec?.qualifiedCount).toBe(8);
    expect(rec?.rejectedCount).toBe(2);
    expect(rec?.targetCount).toBe(5);
    expect(rec?.currentAction).toContain('candidates inspected');
    execMod.clearExecutions();
  });

  it('supports multiple concurrent tasks independently', () => {
    const a = mgr.createTask(baseInput).task;
    const b = mgr.createTask({ ...baseInput, title: 'Research brief', worker: 'research' as const, route: 'research' }).task;
    expect(a.taskId).not.toBe(b.taskId);
    mgr.transition(a.taskId, 'running');
    expect(mgr.getTask(a.taskId).status).toBe('running');
    expect(mgr.getTask(b.taskId).status).toBe('queued'); // switching/running one never alters the other
  });

  it('enforces concurrency limits (PRIORITY 10: queues instead of rejecting)', () => {
    // Default maxActiveHermes = 1.
    const first = mgr.createTask(baseInput);
    expect(first.task).toBeTruthy();
    mgr.transition(first.task.taskId, 'running');
    const second = mgr.createTask({ ...baseInput, title: 'Second hermes task' });
    // At the worker limit the task is QUEUED with concurrency metadata — the
    // UI shows QUEUED (active 1/1, position 1), not a hard error or DISPATCHING.
    expect(second.task).toBeTruthy();
    expect(second.task.status).toBe('queued');
    expect(second.task.metadata?.concurrency).toMatchObject({ active: 1, limit: 1, blocked: true });
  });
});

describe('Background Task Manager — stop/cancel/pause semantics & stale protection', () => {
  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bgtask-'));
    process.env.AGENT_TEAMS_DB_PATH = path.join(tmpDir, 'test.db');
    ({ manager: mgr, repo, control } = await freshModules());
  });
  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  const hermesInput = {
    title: 'Long inspection', objective: 'Inspect everything', originalRequest: 'go',
    route: 'hermes', selectedAgent: 'Hermes', worker: 'hermes' as const,
  };

  it('cancel is terminal — a delayed worker result cannot revive it (Test F)', () => {
    const { task } = mgr.createTask(hermesInput);
    mgr.transition(task.taskId, 'running');
    mgr.cancelTask(task.taskId, 'Cancelled by user.');
    expect(mgr.getTask(task.taskId).status).toBe('cancelled');
    // Delayed worker callback tries to complete the cancelled task.
    mgr.verifyCompletion(task.taskId, { resultText: 'Late result!' });
    const after = mgr.getTask(task.taskId);
    expect(after.status).toBe('cancelled'); // NOT completed
    expect(after.resultText).toBeNull();
  });

  it('stop requests cancellation and preserves history', async () => {
    const { task } = mgr.createTask(hermesInput);
    mgr.transition(task.taskId, 'running');
    let stopped = false;
    mgr.registerWorkerHandlers(task.taskId, { stop: () => { stopped = true; } });
    const result = await mgr.stopTask(task.taskId);
    expect(result.ok).toBe(true);
    expect(stopped).toBe(true);
    expect(mgr.getTask(task.taskId).cancellationRequested).toBe(true);
    // History preserved: stop_requested event exists.
    const events = repo.getEvents(task.taskId);
    expect(events.some((e: any) => e.kind === 'task.stop_requested')).toBe(true);
  });

  it('pause is refused truthfully when the worker cannot checkpoint', async () => {
    const { task } = mgr.createTask({ ...hermesInput, resumable: false });
    mgr.transition(task.taskId, 'running');
    const result = await mgr.pauseTask(task.taskId);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not supported/i);
    expect(result.error).toMatch(/stop/i); // offers Stop instead
    expect(mgr.getTask(task.taskId).status).toBe('running'); // no fake pause
  });

  it('pause/resume works for resumable workers and never restarts silently', async () => {
    const { task } = mgr.createTask({ ...hermesInput, worker: 'codex' as const, resumable: true });
    mgr.transition(task.taskId, 'running');
    let paused = false, resumed = false;
    mgr.registerWorkerHandlers(task.taskId, {
      pause: () => { paused = true; },
      resume: () => { resumed = true; },
    });
    expect((await mgr.pauseTask(task.taskId)).ok).toBe(true);
    expect(paused).toBe(true);
    expect(mgr.getTask(task.taskId).status).toBe('paused');
    expect((await mgr.resumeTask(task.taskId)).ok).toBe(true);
    expect(resumed).toBe(true);
    expect(mgr.getTask(task.taskId).status).toBe('running');
    const events = repo.getEvents(task.taskId);
    expect(events.some((e: any) => e.kind === 'task.resumed')).toBe(true);
  });

  it('retry reuses the existing Board card (no duplicate card)', async () => {
    const { task } = mgr.createTask(hermesInput);
    await flush(); // Board linkage is async — let it settle
    const linked = mgr.getTask(task.taskId);
    expect(linked.linkedBoardCardId).toBeTruthy(); // created at task creation
    mgr.transition(task.taskId, 'failed', { lastError: 'boom' });
    // Simulate the taskControl retry path directly (reuse boardCardId).
    const retry = mgr.createTask({ ...hermesInput, boardCardId: linked.linkedBoardCardId, metadata: { retryOf: task.taskId } });
    expect(retry.task).toBeTruthy();
    expect(retry.task.linkedBoardCardId).toBe(linked.linkedBoardCardId); // same card
    expect(retry.task.taskId).not.toBe(task.taskId); // new task/run
    await flush();
    // linkBoardCard early-returns when a card is already linked → still the same card, never a duplicate.
    const retried = mgr.getTask(retry.task.taskId);
    expect(retried.linkedBoardCardId).toBe(linked.linkedBoardCardId);
  });
});

describe('Background Task Manager — approvals & restore', () => {
  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bgtask-'));
    process.env.AGENT_TEAMS_DB_PATH = path.join(tmpDir, 'test.db');
    ({ manager: mgr, repo, control } = await freshModules());
  });
  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  const hermesInput = {
    title: 'Needs approval', objective: 'run rm -rf /tmp/x', originalRequest: 'go',
    route: 'hermes', selectedAgent: 'Hermes', worker: 'hermes' as const,
  };

  it('approval belongs to the task, persists until resolved, deny blocks the action (Test E)', async () => {
    const { task } = mgr.createTask(hermesInput);
    mgr.transition(task.taskId, 'running');
    mgr.requestApproval(task.taskId, {
      action: 'Execute command', reason: 'Destructive command', command: 'rm -rf /tmp/x',
    });
    expect(mgr.getTask(task.taskId).status).toBe('waiting_approval');
    expect(mgr.getPendingApproval(task.taskId)?.command).toBe('rm -rf /tmp/x');
    // A new conversation message would never dismiss it — only resolveApproval does.
    expect(mgr.listPendingApprovals().length).toBe(1);

    let workerSaw: string | null = null;
    const result = await mgr.resolveApproval(task.taskId, 'deny', async (c) => { workerSaw = c; });
    expect(result.ok).toBe(true);
    expect(workerSaw).toBe('deny'); // denial reached the worker
    const after = mgr.getTask(task.taskId);
    expect(after.status).toBe('blocked');
    expect(after.approvalState).toBe('denied');
    expect(mgr.getPendingApproval(task.taskId)).toBeNull();
  });

  it('restore-after-restart marks non-resumable running tasks blocked with a truthful explanation', () => {
    const { task } = mgr.createTask(hermesInput); // hermes = non-resumable
    mgr.transition(task.taskId, 'running');
    mgr.restoreAfterRestart();
    const restored = mgr.getTask(task.taskId);
    expect(restored.status).toBe('blocked');
    expect(restored.blocker).toMatch(/restart/i);
    expect(restored.blocker).toMatch(/lost/i); // truthful: live worker state is gone
    expect(restored.blocker).toMatch(/resume or retry/i); // offers the recovery path
  });

  it('restore-after-restart leaves resumable CodeX tasks intact (checkpoint survives)', () => {
    const { task } = mgr.createTask({ ...hermesInput, worker: 'codex' as const, resumable: true });
    mgr.transition(task.taskId, 'paused');
    mgr.restoreAfterRestart();
    expect(mgr.getTask(task.taskId).status).toBe('paused'); // untouched — resume is explicit
  });
});

describe('Background Task Manager — task-control intents vs conversation', () => {
  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bgtask-'));
    process.env.AGENT_TEAMS_DB_PATH = path.join(tmpDir, 'test.db');
    ({ manager: mgr, repo, control } = await freshModules());
  });
  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('classifies explicit task-control commands', () => {
    expect(control.classifyTaskControl('pause task T-ABC123')?.type).toBe('pause_task');
    expect(control.classifyTaskControl('resume task T-ABC123')?.type).toBe('resume_task');
    expect(control.classifyTaskControl('stop task T-ABC123')?.type).toBe('stop_task');
    expect(control.classifyTaskControl('cancel task T-ABC123')?.type).toBe('cancel_task');
    expect(control.classifyTaskControl('retry task T-ABC123')?.type).toBe('retry_task');
    expect(control.classifyTaskControl('approve task T-ABC123')?.type).toBe('approve_task');
    expect(control.classifyTaskControl('deny task T-ABC123')?.type).toBe('approve_task');
    expect(control.classifyTaskControl('show active tasks')?.type).toBe('list_tasks');
    expect(control.classifyTaskControl('show blocked tasks')?.type).toBe('list_tasks');
    expect(control.classifyTaskControl('what is Hermes doing')?.type).toBe('agent_status');
    expect(control.classifyTaskControl('what is CodeX doing')?.type).toBe('agent_status');
    expect(control.classifyTaskControl('open the task board')?.type).toBe('open_board');
    const show = control.classifyTaskControl('show task bgtask-123456789');
    expect(show?.type).toBe('show_task');
  });

  it('normal conversation NEVER classifies as task control (separation contract)', () => {
    expect(control.classifyTaskControl('What model are you using?')).toBeNull();
    expect(control.classifyTaskControl('Reply with exactly JARVIS_READY')).toBeNull();
    expect(control.classifyTaskControl('Tell me a joke')).toBeNull();
    expect(control.classifyTaskControl('What provider and model are you using?')).toBeNull();
    expect(control.classifyTaskControl('Ask Hermes to inspect the voice pipeline')).toBeNull(); // delegation, not control
  });

  it('executes list/show control intents against real persisted state', async () => {
    const { task } = mgr.createTask({
      title: 'Visible task', objective: 'x', originalRequest: 'x',
      route: 'hermes', selectedAgent: 'Hermes', worker: 'hermes',
    });
    const listReply = await control.executeTaskControl({ type: 'list_tasks', scope: 'all' });
    expect(listReply).toContain('Visible task');
    const short = listReply.match(/T-[A-Z0-9]+/)?.[0];
    expect(short).toBeTruthy();
    const showReply = await control.executeTaskControl({ type: 'show_task', taskRef: short });
    expect(showReply).toContain('Visible task');
    expect(showReply).toContain('queued');
  });
});

function relinked(a: any, b: any): boolean {
  return a.taskId === b.taskId && a.worker === b.worker && a.route === b.route;
}

/** Let pending async Board linkage (createCard/updateTask) settle. */
function flush(): Promise<void> {
  return new Promise(r => setTimeout(r, 30));
}
