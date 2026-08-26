/**
 * hermesQueueCapacityRestart.test.ts
 *
 * Regression test suite for Hermes Queue / Worker Capacity / Restart Lifecycle.
 *
 * Covers all 12 required invariants:
 *   1. queued Hermes task consumes zero capacity
 *   2. queued task never receives worker stall heartbeat
 *   3. running Hermes task consumes exactly one slot
 *   4. stale running task releases slot
 *   5. released slot dispatches queue position 1
 *   6. restart preserves genuinely queued task as QUEUED
 *   7. restart restores RUNNING only with verified live upstream run
 *   8. unrecoverable upstream run cannot retain slot
 *   9. queue/status/supervisor states cannot disagree
 *   10. "I'm back. Hermes is still working" requires verified upstream liveness
 *   11. terminal task releases capacity exactly once
 *   12. duplicate dispatch remains impossible
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

vi.setConfig({ hookTimeout: 60000, testTimeout: 30000 });

let tmpDir: string;
let backgroundTaskManager: any;
let backgroundTaskRepo: any;
let jarvisExecutionSupervisor: any;
let executionState: any;
let hermesApiService: any;
let dispatchHermesTask: any;
let clearDispatchGuard: any;
let conversationService: any;

async function freshModules() {
  vi.resetModules();
  const managerMod = await import('../services/backgroundTasks/manager.js');
  const storeMod = await import('../services/backgroundTasks/store.js');
  const supervisorMod = await import('../domains/jarvis/executionSupervisor.js');
  const executionStateMod = await import('../services/executionState.js');
  const hermesApiMod = await import('../services/hermesApiService.js');
  const adaptersMod = await import('../services/backgroundTasks/adapters.js');
  const convMod = await import('../domains/conversations/service.js');

  return {
    manager: managerMod.backgroundTaskManager,
    repo: storeMod.backgroundTaskRepo,
    ensureTables: storeMod.ensureBackgroundTaskTables,
    supervisor: supervisorMod.jarvisExecutionSupervisor,
    executionState: executionStateMod,
    hermesApi: hermesApiMod.hermesApiService,
    dispatchHermesTask: adaptersMod.dispatchHermesTask,
    clearDispatchGuard: adaptersMod.clearDispatchGuard,
    conversationService: convMod.conversationService,
  };
}

describe('Hermes Queue, Capacity, and Restart Lifecycle Regression Suite', () => {
  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-queue-test-'));
    process.env.AGENT_TEAMS_DB_PATH = path.join(tmpDir, 'test.db');

    const modules = await freshModules();
    backgroundTaskManager = modules.manager;
    backgroundTaskRepo = modules.repo;
    jarvisExecutionSupervisor = modules.supervisor;
    executionState = modules.executionState;
    hermesApiService = modules.hermesApi;
    dispatchHermesTask = modules.dispatchHermesTask;
    clearDispatchGuard = modules.clearDispatchGuard;
    conversationService = modules.conversationService;

    modules.ensureTables();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    try {
      if (tmpDir && fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    } catch {}
  });

  it('1. queued Hermes task consumes zero capacity', async () => {
    // Fill the 1/1 Hermes slot with a running task
    const t1 = backgroundTaskManager.createTask({
      title: 'Hermes Slot Owner',
      objective: 'Run research 1',
      originalRequest: 'Run research 1',
      route: 'hermes',
      selectedAgent: 'Hermes',
      worker: 'hermes',
    }).task!;
    backgroundTaskManager.transition(t1.taskId, 'running');

    // Create a 2nd task - should be queued
    const t2 = backgroundTaskManager.createTask({
      title: 'Queued Hermes Task',
      objective: 'Run research 2',
      originalRequest: 'Run research 2',
      route: 'hermes',
      selectedAgent: 'Hermes',
      worker: 'hermes',
    }).task!;
    expect(t2.status).toBe('queued');

    // Capacity calculation: active hermes tasks count must be 1 (only t1, NOT t2)
    const activeHermes = backgroundTaskManager.listTasks({ activeOnly: true })
      .filter((t: any) => t.worker === 'hermes' && t.status !== 'queued' && (t.status === 'running' || t.status === 'planning'));
    expect(activeHermes.length).toBe(1);
    expect(activeHermes[0].taskId).toBe(t1.taskId);

    // Create a 3rd task - should also be queued at position 2, still 1 active
    const t3 = backgroundTaskManager.createTask({
      title: 'Queued Hermes Task 2',
      objective: 'Run research 3',
      originalRequest: 'Run research 3',
      route: 'hermes',
      selectedAgent: 'Hermes',
      worker: 'hermes',
    }).task!;
    expect(t3.status).toBe('queued');

    const activeHermesAfter = backgroundTaskManager.listTasks({ activeOnly: true })
      .filter((t: any) => t.worker === 'hermes' && t.status !== 'queued' && (t.status === 'running' || t.status === 'planning'));
    expect(activeHermesAfter.length).toBe(1);
  });

  it('2. queued task never receives worker stall heartbeat', async () => {
    const tQueued = backgroundTaskManager.createTask({
      title: 'Queued Hermes Task',
      objective: 'Inspect files',
      originalRequest: 'Inspect files',
      route: 'hermes',
      selectedAgent: 'Hermes',
      worker: 'hermes',
    }).task!;
    expect(tQueued.status).toBe('queued');

    jarvisExecutionSupervisor.superviseTask({
      taskId: tQueued.taskId,
      operationId: 'op-q-1',
      conversationId: 'conv-q-1',
      worker: 'hermes',
      initialState: 'QUEUED',
    });

    const supervised = (jarvisExecutionSupervisor as any).activeTasks.get(tQueued.taskId);
    expect(supervised).toBeDefined();
    expect(supervised.state).toBe('QUEUED');

    // Simulate 60s of idle time
    supervised.lastActivityAt = Date.now() - 60_000;

    await (jarvisExecutionSupervisor as any).checkHeartbeats();

    // Must remain QUEUED, must NOT change to POSSIBLE_STALL, must NOT emit stall notice
    expect(supervised.state).toBe('QUEUED');
    expect(supervised.stallNoticeEmitted).toBe(false);

    // Simulate 120s of idle time
    supervised.lastActivityAt = Date.now() - 120_000;
    await (jarvisExecutionSupervisor as any).checkHeartbeats();
    expect(supervised.state).toBe('QUEUED');
    expect(backgroundTaskRepo.getTask(tQueued.taskId)?.status).toBe('queued');
  });

  it('3. running Hermes task consumes exactly one slot', async () => {
    const t = backgroundTaskManager.createTask({
      title: 'Running Hermes Task',
      objective: 'Active execution',
      originalRequest: 'Active execution',
      route: 'hermes',
      selectedAgent: 'Hermes',
      worker: 'hermes',
    }).task!;

    backgroundTaskManager.transition(t.taskId, 'running');

    const summary = backgroundTaskManager.summary();
    expect(summary.active).toBe(1);
    expect(summary.queued).toBe(0);

    const activeHermes = backgroundTaskManager.listTasks({ activeOnly: true })
      .filter((task: any) => task.worker === 'hermes' && task.status === 'running');
    expect(activeHermes.length).toBe(1);
  });

  it('4. stale running task releases slot', async () => {
    const t = backgroundTaskManager.createTask({
      title: 'Stalled Hermes Task',
      objective: 'Deadlock test',
      originalRequest: 'Deadlock test',
      route: 'hermes',
      selectedAgent: 'Hermes',
      worker: 'hermes',
    }).task!;
    backgroundTaskManager.transition(t.taskId, 'running');

    jarvisExecutionSupervisor.superviseTask({
      taskId: t.taskId,
      operationId: 'op-stall-rel',
      conversationId: 'conv-stall-rel',
      worker: 'hermes',
      initialState: 'RUNNING_ACTIVE',
    });

    vi.spyOn(hermesApiService, 'probeRunLiveness').mockResolvedValue({
      status: 'failed',
      upstreamStatus: 'failed',
      isAlive: false,
    });

    const supervised = (jarvisExecutionSupervisor as any).activeTasks.get(t.taskId);
    supervised.lastActivityAt = Date.now() - 95_000; // >= 90s hard stall

    await (jarvisExecutionSupervisor as any).checkHeartbeats();

    const dbTask = backgroundTaskRepo.getTask(t.taskId);
    expect(dbTask.status).toBe('failed');

    const activeHermes = backgroundTaskManager.listTasks({ activeOnly: true })
      .filter((task: any) => task.worker === 'hermes' && task.status === 'running');
    expect(activeHermes.length).toBe(0);
  });

  it('5. released slot dispatches queue position 1', async () => {
    // Running task 1
    const t1 = backgroundTaskManager.createTask({
      title: 'Task 1',
      objective: 'Run 1',
      originalRequest: 'Run 1',
      route: 'hermes',
      selectedAgent: 'Hermes',
      worker: 'hermes',
    }).task!;
    backgroundTaskManager.transition(t1.taskId, 'running');

    // Queued task 2
    const t2 = backgroundTaskManager.createTask({
      title: 'Task 2',
      objective: 'Run 2',
      originalRequest: 'Run 2',
      route: 'hermes',
      selectedAgent: 'Hermes',
      worker: 'hermes',
    }).task!;
    expect(t2.status).toBe('queued');

    // Mock Hermes createRun so dispatch succeeds
    vi.spyOn(hermesApiService, 'createRun').mockResolvedValue({
      id: 'hapi-dispatched-2',
      hermesRunId: 'hr-2',
      cardId: null,
      prompt: 'Run 2',
      status: 'running',
      provider: 'ollama-cloud',
      model: 'gpt-oss:20b',
      events: [],
      pendingApproval: null,
      finalText: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    // Complete task 1 -> releases slot and pumps queue
    backgroundTaskManager.transition(t1.taskId, 'completed');

    // Allow pump async dispatch to execute
    await new Promise(r => setTimeout(r, 50));

    const updatedT2 = backgroundTaskRepo.getTask(t2.taskId);
    expect(updatedT2.status === 'running' || updatedT2.status === 'planning').toBe(true);
  });

  it('6. restart preserves genuinely queued task as QUEUED', async () => {
    const tQueued = backgroundTaskManager.createTask({
      title: 'Queued Task Before Restart',
      objective: 'Wait in queue',
      originalRequest: 'Wait in queue',
      route: 'hermes',
      selectedAgent: 'Hermes',
      worker: 'hermes',
    }).task!;
    expect(tQueued.status).toBe('queued');

    // Simulate restart
    (backgroundTaskManager as any).restored = false;
    backgroundTaskManager.restoreAfterRestart();

    const after = backgroundTaskRepo.getTask(tQueued.taskId);
    expect(after.status).toBe('queued');

    // Verify supervisor reconciliation
    (jarvisExecutionSupervisor as any).activeTasks.clear();
    jarvisExecutionSupervisor.reconcileSupervisedTasksAfterRestart();
    const sup = jarvisExecutionSupervisor.getSupervisedTask(tQueued.taskId);
    expect(sup).toBeDefined();
    expect(sup.state).toBe('QUEUED');
  });

  it('7. restart restores RUNNING only with verified live upstream run', async () => {
    const tRunning = backgroundTaskManager.createTask({
      title: 'Running Task Before Restart',
      objective: 'Active run',
      originalRequest: 'Active run',
      route: 'hermes',
      selectedAgent: 'Hermes',
      worker: 'hermes',
    }).task!;
    backgroundTaskManager.transition(tRunning.taskId, 'running');
    backgroundTaskRepo.updateTask(tRunning.taskId, { linkedRunId: 'hapi-live-upstream' });

    vi.spyOn(hermesApiService, 'probeRunLiveness').mockResolvedValue({
      status: 'running',
      upstreamStatus: 'running',
      isAlive: true,
    });

    (backgroundTaskManager as any).restored = false;
    backgroundTaskManager.restoreAfterRestart();

    await new Promise(r => setTimeout(r, 50));
    const after = backgroundTaskRepo.getTask(tRunning.taskId);
    expect(after.status).toBe('running');
  });

  it('8. unrecoverable upstream run cannot retain slot', async () => {
    const tRunning = backgroundTaskManager.createTask({
      title: 'Dead Task On Restart',
      objective: 'Will fail on restart',
      originalRequest: 'Will fail on restart',
      route: 'hermes',
      selectedAgent: 'Hermes',
      worker: 'hermes',
    }).task!;
    backgroundTaskManager.transition(tRunning.taskId, 'running');
    backgroundTaskRepo.updateTask(tRunning.taskId, { linkedRunId: 'hapi-dead-upstream' });

    vi.spyOn(hermesApiService, 'probeRunLiveness').mockResolvedValue({
      status: 'failed',
      upstreamStatus: 'failed',
      isAlive: false,
    });

    (backgroundTaskManager as any).restored = false;
    backgroundTaskManager.restoreAfterRestart();

    await new Promise(r => setTimeout(r, 50));
    const after = backgroundTaskRepo.getTask(tRunning.taskId);
    expect(after.status === 'blocked' || after.status === 'failed').toBe(true);

    const activeHermes = backgroundTaskManager.listTasks({ activeOnly: true })
      .filter((task: any) => task.worker === 'hermes' && task.status === 'running');
    expect(activeHermes.length).toBe(0);
  });

  it('9. queue/status/supervisor states cannot disagree', async () => {
    const t = backgroundTaskManager.createTask({
      title: 'State Sync Task',
      objective: 'Sync test',
      originalRequest: 'Sync test',
      route: 'hermes',
      selectedAgent: 'Hermes',
      worker: 'hermes',
    }).task!;

    jarvisExecutionSupervisor.superviseTask({
      taskId: t.taskId,
      operationId: 'op-sync-1',
      conversationId: 'conv-sync-1',
      worker: 'hermes',
      initialState: 'QUEUED',
    });

    const sup = jarvisExecutionSupervisor.getSupervisedTask(t.taskId);
    const dbTask = backgroundTaskRepo.getTask(t.taskId);
    expect(sup.state).toBe('QUEUED');
    expect(dbTask.status).toBe('queued');

    // Move to running via event
    jarvisExecutionSupervisor.recordActivity(t.taskId, 'task_started');
    backgroundTaskManager.transition(t.taskId, 'running');

    const sup2 = jarvisExecutionSupervisor.getSupervisedTask(t.taskId);
    const dbTask2 = backgroundTaskRepo.getTask(t.taskId);
    expect(sup2.state).toBe('RUNNING_ACTIVE');
    expect(dbTask2.status).toBe('running');
  });

  it('10. "I\'m back. Hermes is still working" requires verified upstream liveness', async () => {
    const convId = 'conv-test-recovery-msg';
    await conversationService.createConversation('Test Recovery Conv');

    const t = backgroundTaskManager.createTask({
      title: 'Dead Task No False Recovery',
      objective: 'Dead task',
      originalRequest: 'Dead task',
      route: 'hermes',
      selectedAgent: 'Hermes',
      worker: 'hermes',
      conversationId: convId,
    }).task!;
    backgroundTaskManager.transition(t.taskId, 'running');
    backgroundTaskRepo.updateTask(t.taskId, { linkedRunId: 'hapi-dead-run-msg' });

    vi.spyOn(hermesApiService, 'probeRunLiveness').mockResolvedValue({
      status: 'unknown',
      upstreamStatus: 'unknown',
      isAlive: false,
    });

    (jarvisExecutionSupervisor as any).activeTasks.clear();
    jarvisExecutionSupervisor.reconcileSupervisedTasksAfterRestart();

    await new Promise(r => setTimeout(r, 100));

    const msgs = await conversationService.getMessages(convId);
    const recoveryMsg = msgs.find((m: any) => typeof m.content === 'string' && m.content.includes("I'm back."));
    expect(recoveryMsg).toBeUndefined();
  });

  it('11. terminal task releases capacity exactly once', async () => {
    const t = backgroundTaskManager.createTask({
      title: 'Terminal Once Task',
      objective: 'Run once',
      originalRequest: 'Run once',
      route: 'hermes',
      selectedAgent: 'Hermes',
      worker: 'hermes',
    }).task!;
    backgroundTaskManager.transition(t.taskId, 'running');

    const pumpSpy = vi.spyOn(backgroundTaskManager, 'pumpQueuedForWorker');

    // First completion
    backgroundTaskManager.transition(t.taskId, 'completed');
    expect(pumpSpy).toHaveBeenCalledTimes(1);

    // Second redundant completion on already terminal task
    backgroundTaskManager.transition(t.taskId, 'completed');
    // Transition ignores terminal task, pump is NOT called again
    expect(pumpSpy).toHaveBeenCalledTimes(1);
  });

  it('12. duplicate dispatch remains impossible', async () => {
    const t = backgroundTaskManager.createTask({
      title: 'Dedup Task',
      objective: 'Dedup test',
      originalRequest: 'Dedup test',
      route: 'hermes',
      selectedAgent: 'Hermes',
      worker: 'hermes',
    }).task!;

    vi.spyOn(hermesApiService, 'createRun').mockResolvedValue({
      id: 'hapi-dedup-1',
      hermesRunId: 'hr-dedup-1',
      cardId: null,
      prompt: 'test',
      status: 'queued',
      provider: 'ollama-cloud',
      model: 'gpt-oss:20b',
      events: [],
      pendingApproval: null,
      finalText: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    clearDispatchGuard(t.taskId);
    const r1 = await dispatchHermesTask(t);
    expect(r1.ok).toBe(true);

    const r2 = await dispatchHermesTask(t);
    expect(r2.ok).toBe(false);
    expect(r2.error).toContain('already dispatched');
  });
});
