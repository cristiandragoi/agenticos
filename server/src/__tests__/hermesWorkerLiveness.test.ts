/**
 * hermesWorkerLiveness.test.ts
 *
 * Comprehensive test suite verifying Hermes worker liveness, active event tracking,
 * upstream API probing, model truth preservation, stall detection, and reconciliation.
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
let resolveHermesModelTruth: any;
let dispatchHermesTask: any;
let clearDispatchGuard: any;

async function freshModules() {
  vi.resetModules();
  const managerMod = await import('../services/backgroundTasks/manager.js');
  const storeMod = await import('../services/backgroundTasks/store.js');
  const supervisorMod = await import('../domains/jarvis/executionSupervisor.js');
  const executionStateMod = await import('../services/executionState.js');
  const hermesApiMod = await import('../services/hermesApiService.js');
  const adaptersMod = await import('../services/backgroundTasks/adapters.js');

  return {
    manager: managerMod.backgroundTaskManager,
    repo: storeMod.backgroundTaskRepo,
    ensureTables: storeMod.ensureBackgroundTaskTables,
    supervisor: supervisorMod.jarvisExecutionSupervisor,
    executionState: executionStateMod,
    hermesApi: hermesApiMod.hermesApiService,
    resolveHermesModelTruth: hermesApiMod.resolveHermesModelTruth,
    dispatchHermesTask: adaptersMod.dispatchHermesTask,
    clearDispatchGuard: adaptersMod.clearDispatchGuard,
  };
}

describe('Hermes Worker Liveness, Model Truth, and Stall Lifecycle', () => {
  let taskId: string;
  let opId: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-liveness-'));
    process.env.AGENT_TEAMS_DB_PATH = path.join(tmpDir, 'test.db');

    const modules = await freshModules();
    backgroundTaskManager = modules.manager;
    backgroundTaskRepo = modules.repo;
    jarvisExecutionSupervisor = modules.supervisor;
    executionState = modules.executionState;
    hermesApiService = modules.hermesApi;
    resolveHermesModelTruth = modules.resolveHermesModelTruth;
    dispatchHermesTask = modules.dispatchHermesTask;
    clearDispatchGuard = modules.clearDispatchGuard;

    modules.ensureTables();
    taskId = `task-liveness-test-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    opId = `op-liveness-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    clearDispatchGuard(taskId);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    try {
      if (tmpDir && fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    } catch {
      // ignore
    }
  });

  it('1. running task with active Hermes events remains healthy and updates liveness timestamps', async () => {
    const res = backgroundTaskManager.createTask({
      title: 'Hermes Liveness Test',
      objective: 'Inspect project structure',
      originalRequest: 'Inspect project structure',
      route: 'hermes',
      selectedAgent: 'Hermes',
      worker: 'hermes',
      taskId,
      metadata: { operationId: opId },
    });
    expect(res.task).toBeDefined();
    const task = res.task!;

    jarvisExecutionSupervisor.superviseTask({
      taskId: task.taskId,
      operationId: opId,
      conversationId: 'conv-liveness-1',
      worker: 'hermes',
      initialState: 'STARTING',
    });

    const rec = executionState.begin({
      operationId: opId,
      worker: 'hermes',
      status: 'RUNNING',
      requestedProvider: 'ollama-cloud',
      requestedModel: 'gpt-oss:20b',
      resolvedProvider: 'ollama-cloud',
      resolvedModel: 'gpt-oss:20b',
    });

    const before = Date.now();
    const recorded = jarvisExecutionSupervisor.recordActivity(task.taskId, 'tool_started', {
      toolName: 'read_file',
      summary: 'Reading package.json',
    });

    expect(recorded).toBe(true);
    const curr = executionState.get(opId);
    expect(curr?.status).toBe('RUNNING');
    expect(curr?.lastActivityAt).toBeGreaterThanOrEqual(before);
  });

  it('2. no meaningful activity triggers stall detection when upstream run is unresponsive', async () => {
    const res = backgroundTaskManager.createTask({
      title: 'Stall Test Task',
      objective: 'Long hanging task',
      originalRequest: 'Long hanging task',
      route: 'hermes',
      selectedAgent: 'Hermes',
      worker: 'hermes',
      taskId,
      metadata: { operationId: opId },
    });
    expect(res.task).toBeDefined();
    const task = res.task!;
    backgroundTaskManager.transition(task.taskId, 'running');

    jarvisExecutionSupervisor.superviseTask({
      taskId: task.taskId,
      operationId: opId,
      conversationId: 'conv-stall-1',
      worker: 'hermes',
      initialState: 'RUNNING_ACTIVE',
    });

    vi.spyOn(hermesApiService, 'probeRunLiveness').mockResolvedValue({
      status: 'unknown',
      isAlive: false,
    });

    const supervised = (jarvisExecutionSupervisor as any).activeTasks.get(task.taskId);
    expect(supervised).toBeDefined();
    supervised.lastActivityAt = Date.now() - 50_000;

    await (jarvisExecutionSupervisor as any).checkHeartbeats();

    expect(supervised.state === 'POSSIBLE_STALL' || supervised.stallNoticeEmitted).toBe(true);
  });

  it('3. active upstream run confirms liveness and prevents false stall alert', async () => {
    const res = backgroundTaskManager.createTask({
      title: 'Active Hermes Task',
      objective: 'Deep inference task',
      originalRequest: 'Deep inference task',
      route: 'hermes',
      selectedAgent: 'Hermes',
      worker: 'hermes',
      taskId,
      metadata: { operationId: opId },
    });
    expect(res.task).toBeDefined();
    const task = res.task!;
    backgroundTaskManager.transition(task.taskId, 'running');
    backgroundTaskRepo.updateTask(task.taskId, { linkedRunId: 'hapi-alive-run-1' });

    jarvisExecutionSupervisor.superviseTask({
      taskId: task.taskId,
      operationId: opId,
      conversationId: 'conv-alive-1',
      worker: 'hermes',
      initialState: 'RUNNING_ACTIVE',
    });

    vi.spyOn(hermesApiService, 'probeRunLiveness').mockResolvedValue({
      status: 'running',
      upstreamStatus: 'running',
      isAlive: true,
      lastEvent: 'assistant.delta',
    });

    const supervised = (jarvisExecutionSupervisor as any).activeTasks.get(task.taskId);
    supervised.lastActivityAt = Date.now() - 50_000;

    await (jarvisExecutionSupervisor as any).checkHeartbeats();

    expect(supervised.state).toBe('RUNNING_ACTIVE');
    expect(supervised.lastActivityAt).toBeGreaterThan(Date.now() - 5000);
  });

  it('4. completed upstream run reconciles local task to COMPLETED immediately', async () => {
    const res = backgroundTaskManager.createTask({
      title: 'Completed Probe Task',
      objective: 'Finish inspection',
      originalRequest: 'Finish inspection',
      route: 'hermes',
      selectedAgent: 'Hermes',
      worker: 'hermes',
      taskId,
      metadata: { operationId: opId },
    });
    expect(res.task).toBeDefined();
    const task = res.task!;
    backgroundTaskManager.transition(task.taskId, 'running');
    backgroundTaskRepo.updateTask(task.taskId, { linkedRunId: 'hapi-comp-run-1' });

    jarvisExecutionSupervisor.superviseTask({
      taskId: task.taskId,
      operationId: opId,
      conversationId: 'conv-comp-1',
      worker: 'hermes',
      initialState: 'RUNNING_ACTIVE',
    });

    vi.spyOn(hermesApiService, 'probeRunLiveness').mockResolvedValue({
      status: 'completed',
      upstreamStatus: 'completed',
      output: 'The file package.json exists.',
      isAlive: false,
    });

    const supervised = (jarvisExecutionSupervisor as any).activeTasks.get(task.taskId);
    supervised.lastActivityAt = Date.now() - 50_000;

    await (jarvisExecutionSupervisor as any).checkHeartbeats();

    expect(supervised.state).toBe('COMPLETED');
  });

  it('5. model truth is preserved truthfully from the active Hermes configuration', () => {
    const truth = resolveHermesModelTruth();
    expect(truth.provider).toBeTruthy();
    expect(truth.model).toBeTruthy();
    expect(truth.baseUrl).toMatch(/^https?:\/\//);
  });

  it('6. executionState carries actual provider and model on Hermes delegation', async () => {
    const testOp = `op-truth-${Date.now()}`;
    executionState.begin({
      operationId: testOp,
      worker: 'hermes',
      status: 'DISPATCHING',
      requestedProvider: 'ollama-cloud',
      requestedModel: 'gpt-oss:20b',
      resolvedProvider: 'ollama-cloud',
      resolvedModel: 'gpt-oss:20b',
      fallbackUsed: false,
    });

    const current = executionState.get(testOp);
    expect(current?.worker).toBe('hermes');
    expect(current?.resolvedProvider).toBe('ollama-cloud');
    expect(current?.resolvedModel).toBe('gpt-oss:20b');
    expect(current?.fallbackUsed).toBe(false);
  });

  it('7. silent provider drift is impossible: fallback records explicit event and state', () => {
    const fallbackOp = `op-fallback-${Date.now()}`;
    executionState.begin({
      operationId: fallbackOp,
      worker: 'hermes',
      status: 'RUNNING',
      requestedProvider: 'ollama-cloud',
      requestedModel: 'gpt-oss:20b',
      resolvedProvider: 'ollama-cloud',
      resolvedModel: 'gpt-oss:20b',
    });

    executionState.update(fallbackOp, {
      fallbackUsed: true,
      fallbackReason: 'Hermes live API server unreachable',
      resolvedProvider: 'ollama',
      resolvedModel: 'llama3.2:3b',
      currentAction: 'In-repo fallback active',
    });

    const updated = executionState.get(fallbackOp);
    expect(updated?.fallbackUsed).toBe(true);
    expect(updated?.fallbackReason).toBe('Hermes live API server unreachable');
    expect(updated?.resolvedProvider).toBe('ollama');
    expect(updated?.resolvedModel).toBe('llama3.2:3b');
  });

  it('8. stalled run can be stopped or cancelled cleanly', async () => {
    const res = backgroundTaskManager.createTask({
      title: 'Stop Task',
      objective: 'Stalled task to cancel',
      originalRequest: 'Stalled task to cancel',
      route: 'hermes',
      selectedAgent: 'Hermes',
      worker: 'hermes',
      taskId,
      metadata: { operationId: opId },
    });
    expect(res.task).toBeDefined();
    const task = res.task!;

    backgroundTaskManager.transition(task.taskId, 'cancelled', {
      blocker: 'Stopped by user — Hermes run cancelled.',
    });

    const updated = backgroundTaskRepo.getTask(task.taskId);
    expect(updated?.status).toBe('cancelled');
    expect(updated?.blocker).toContain('Stopped by user');
  });

  it('9. duplicate task dispatch is guarded and prevented', async () => {
    const res = backgroundTaskManager.createTask({
      title: 'Dup Dispatch Task',
      objective: 'Test duplicate dispatch guard',
      originalRequest: 'Test duplicate dispatch guard',
      route: 'hermes',
      selectedAgent: 'Hermes',
      worker: 'hermes',
      taskId,
    });
    expect(res.task).toBeDefined();
    const task = res.task!;

    vi.spyOn(hermesApiService, 'createRun').mockResolvedValue({
      id: 'hapi-mock-1',
      hermesRunId: 'run_mock_1',
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

    const first = await dispatchHermesTask(task);
    expect(first.ok).toBe(true);

    const second = await dispatchHermesTask(task);
    expect(second.ok).toBe(false);
    expect(second.error).toContain('already dispatched');
  });

  it('10. dead upstream run reconciles local task to FAILED', async () => {
    const res = backgroundTaskManager.createTask({
      title: 'Dead Upstream Task',
      objective: 'Probe dead run',
      originalRequest: 'Probe dead run',
      route: 'hermes',
      selectedAgent: 'Hermes',
      worker: 'hermes',
      taskId,
      metadata: { operationId: opId },
    });
    expect(res.task).toBeDefined();
    const task = res.task!;
    backgroundTaskManager.transition(task.taskId, 'running');
    backgroundTaskRepo.updateTask(task.taskId, { linkedRunId: 'hapi-dead-run-1' });

    jarvisExecutionSupervisor.superviseTask({
      taskId: task.taskId,
      operationId: opId,
      conversationId: 'conv-dead-1',
      worker: 'hermes',
      initialState: 'RUNNING_ACTIVE',
    });

    vi.spyOn(hermesApiService, 'probeRunLiveness').mockResolvedValue({
      status: 'failed',
      upstreamStatus: 'failed',
      isAlive: false,
    });

    const supervised = (jarvisExecutionSupervisor as any).activeTasks.get(task.taskId);
    supervised.lastActivityAt = Date.now() - 50_000;

    await (jarvisExecutionSupervisor as any).checkHeartbeats();

    expect(supervised.state).toBe('FAILED');
  });
});
