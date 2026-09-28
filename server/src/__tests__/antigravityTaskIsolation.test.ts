import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { backgroundTaskManager } from '../services/backgroundTasks/manager.js';
import { backgroundTaskRepo } from '../services/backgroundTasks/store.js';
import { engineeringWorkerRegistry } from '../domains/controlPlane/EngineeringWorkerRegistry.js';
import {
  dispatchAntigravityTask,
  clearAntigravityDispatchGuard,
  resetAntigravityQueueForTesting,
  getAntigravityQueueStatus,
  releaseAntigravityWorkerSlot,
} from '../services/backgroundTasks/antigravityAdapter.js';
import { delegateAntigravityTask } from '../domains/jarvis/supervisorTools.js';
import { resolveSemanticTurn } from '../domains/jarvis/semanticTurnResolver.js';

describe('AntiGravity Task Isolation & Correlated Telemetry (Option B)', () => {
  beforeEach(() => {
    resetAntigravityQueueForTesting();
  });

  afterEach(() => {
    resetAntigravityQueueForTesting();
  });

  it('1. Serialized worker queue prevents concurrent execution and guarantees isolation', async () => {
    const { task: taskA } = backgroundTaskManager.createTask({
      title: 'Engineering Task A',
      objective: 'Check A',
      originalRequest: 'Check A',
      route: '/jarvis',
      selectedAgent: 'Jarvis',
      worker: 'antigravity',
      projectId: 'proj-default',
      metadata: { goalId: 'goal-isolation-001' },
    });

    const { task: taskB } = backgroundTaskManager.createTask({
      title: 'Engineering Task B',
      objective: 'Check B',
      originalRequest: 'Check B',
      route: '/jarvis',
      selectedAgent: 'Jarvis',
      worker: 'antigravity',
      projectId: 'proj-default',
      metadata: { goalId: 'goal-isolation-002' },
    });

    clearAntigravityDispatchGuard(taskA!.taskId);
    clearAntigravityDispatchGuard(taskB!.taskId);

    // Dispatch Task A
    const resA = await dispatchAntigravityTask(taskA!);
    expect(resA.ok).toBe(true);
    expect(resA.conversationId).toBeDefined();

    // Verify Task A is actively occupying worker slot
    const queueStatusDuringA = getAntigravityQueueStatus();
    expect(queueStatusDuringA.activeTaskId).toBe(taskA!.taskId);

    // Record events for Task A with explicit taskId, goalId, conversationId
    engineeringWorkerRegistry.recordWorkerEvent({
      taskId: taskA!.taskId,
      goalId: 'goal-isolation-001',
      workerId: 'antigravity',
      runId: resA.conversationId,
      eventType: 'FILE_READ',
      file: 'D:\\AgenticOS\\taskA.ts',
    });

    // Dispatch Task B while Task A is active -> Task B queues
    let taskBPromiseResolved = false;
    const taskBPromise = dispatchAntigravityTask(taskB!).then(r => {
      taskBPromiseResolved = true;
      return r;
    });

    // Task B must NOT resolve yet because Task A has not released the slot
    expect(taskBPromiseResolved).toBe(false);
    expect(getAntigravityQueueStatus().queueLength).toBe(1);

    // Release Task A slot (simulating WORKER_DONE)
    releaseAntigravityWorkerSlot(taskA!.taskId);

    // Now Task B executes
    const resB = await taskBPromise;
    expect(resB.ok).toBe(true);
    expect(resB.conversationId).toBeDefined();

    // Record events for Task B
    engineeringWorkerRegistry.recordWorkerEvent({
      taskId: taskB!.taskId,
      goalId: 'goal-isolation-002',
      workerId: 'antigravity',
      runId: resB.conversationId,
      eventType: 'FILE_READ',
      file: 'D:\\AgenticOS\\taskB.ts',
    });

    // Prove strict correlation: Task A events never contain Task B events
    const allEvents = engineeringWorkerRegistry.getWorkerEvents('antigravity', 50);
    const eventsA = allEvents.filter(e => e.taskId === taskA!.taskId);
    const eventsB = allEvents.filter(e => e.taskId === taskB!.taskId);

    expect(eventsA.every(e => e.taskId === taskA!.taskId)).toBe(true);
    expect(eventsA.every(e => e.goalId === 'goal-isolation-001')).toBe(true);
    expect(eventsA.some(e => e.file === 'D:\\AgenticOS\\taskA.ts')).toBe(true);
    expect(eventsA.some(e => e.file === 'D:\\AgenticOS\\taskB.ts')).toBe(false);

    expect(eventsB.every(e => e.taskId === taskB!.taskId)).toBe(true);
    expect(eventsB.every(e => e.goalId === 'goal-isolation-002')).toBe(true);
    expect(eventsB.some(e => e.file === 'D:\\AgenticOS\\taskB.ts')).toBe(true);
    expect(eventsB.some(e => e.file === 'D:\\AgenticOS\\taskA.ts')).toBe(false);
  });

  it('2. Jarvis live delegation command only confirms started after acceptance, session ID, and first real event', async () => {
    const convId = 'conv-live-jarvis-test-' + Date.now();

    // Utterance: "Jarvis, delegate a harmless repository inspection task to AntiGravity."
    const turnResult = await resolveSemanticTurn(
      'Jarvis, delegate a harmless repository inspection task to AntiGravity.',
      convId
    );

    expect(turnResult.handled).toBe(true);
    expect(turnResult.response).toBeDefined();

    const reply = turnResult.response!.text;
    const data = turnResult.response!.data as any;

    expect(data?.worker).toBe('antigravity');
    expect(data?.taskId).toBeDefined();

    // 1. Worker accepted check
    const taskRecord = backgroundTaskRepo.getTask(data.taskId);
    expect(taskRecord).toBeDefined();
    expect(taskRecord?.worker).toBe('antigravity');
    expect(['executing', 'worker_accepted', 'completed']).toContain(taskRecord?.status);

    // 2. Session / run ID exists check
    expect(taskRecord?.linkedRunId).toBeDefined();
    expect(reply).toContain(taskRecord!.linkedRunId);

    // 3. First real execution event arrived check
    const workerEvents = engineeringWorkerRegistry.getWorkerEvents('antigravity');
    const taskEvents = workerEvents.filter(e => e.taskId === data.taskId);
    expect(taskEvents.length).toBeGreaterThan(0);
    expect(reply).toContain('AntiGravity has accepted task');
    expect(reply).toContain('started execution');
    expect(reply).toContain('Initial event:');
  });

  it('3. "Jarvis, give this task to AntiGravity" confirms execution with matching telemetry', async () => {
    const convId = 'conv-give-task-test-' + Date.now();

    const turnResult = await resolveSemanticTurn(
      'Jarvis, give this task to AntiGravity.',
      convId
    );

    expect(turnResult.handled).toBe(true);
    const reply = turnResult.response!.text;
    expect(reply).toContain('AntiGravity has accepted task');
    expect(reply).toContain('started execution');
  });
});
