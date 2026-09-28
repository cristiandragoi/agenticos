import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { backgroundTaskManager } from '../services/backgroundTasks/manager.js';
import { backgroundTaskRepo } from '../services/backgroundTasks/store.js';
import {
  engineeringWorkerRegistry,
} from '../domains/controlPlane/EngineeringWorkerRegistry.js';
import {
  dispatchAntigravityTask,
  clearAntigravityDispatchGuard,
} from '../services/backgroundTasks/antigravityAdapter.js';

describe('AntiGravity Engineering Worker Acceptance Test', () => {
  it('1. Executes safe engineering task with AntiGravity and captures real-time event pipeline', async () => {
    // A safe inspection task targeting a status file in D:\AgenticOS
    const { task } = backgroundTaskManager.createTask({
      title: 'Inspect AntiGravity Worker Integration State',
      objective: 'Inspect repository status and verify first-class engineering worker telemetry',
      originalRequest: 'Inspect repository status and verify first-class engineering worker telemetry',
      route: '/jarvis',
      selectedAgent: 'Jarvis',
      worker: 'antigravity',
      projectId: 'proj-default',
      workspaceRoot: 'D:\\AgenticOS',
    });

    expect(task).toBeDefined();
    clearAntigravityDispatchGuard(task!.taskId);

    // 1. Dispatch
    const dispatchResult = await dispatchAntigravityTask(task!, 'D:\\AgenticOS');
    expect(dispatchResult.ok).toBe(true);

    const initialTask = backgroundTaskRepo.getTask(task!.taskId);
    expect(initialTask?.status).toBe('executing');
    expect(initialTask?.worker).toBe('antigravity');

    // 2. Verify initial events in EngineeringWorkerRegistry
    const agEvents = engineeringWorkerRegistry.getWorkerEvents('antigravity');
    const workerAccepted = agEvents.find(e => e.taskId === task!.taskId && e.eventType === 'WORKER_ACCEPTED');
    const repoOpened = agEvents.find(e => e.taskId === task!.taskId && e.eventType === 'REPOSITORY_OPENED');

    expect(workerAccepted).toBeDefined();
    expect(repoOpened).toBeDefined();

    // 3. Emulate AntiGravity tool events flowing into the registry
    engineeringWorkerRegistry.recordWorkerEvent({
      taskId: task!.taskId,
      workerId: 'antigravity',
      runId: dispatchResult.conversationId,
      eventType: 'FILE_READ',
      file: 'D:\\AgenticOS\\package.json',
    });

    engineeringWorkerRegistry.recordWorkerEvent({
      taskId: task!.taskId,
      workerId: 'antigravity',
      runId: dispatchResult.conversationId,
      eventType: 'COMMAND_STARTED',
      command: 'git status --porcelain',
    });

    engineeringWorkerRegistry.recordWorkerEvent({
      taskId: task!.taskId,
      workerId: 'antigravity',
      runId: dispatchResult.conversationId,
      eventType: 'COMMAND_OUTPUT',
      command: 'git status --porcelain',
      output: '',
      exitCode: 0,
    });

    // 4. Model finishes its turn -> WORKER_DONE
    engineeringWorkerRegistry.recordWorkerEvent({
      taskId: task!.taskId,
      workerId: 'antigravity',
      runId: dispatchResult.conversationId,
      eventType: 'WORKER_DONE',
      output: 'Inspected repository state successfully. No issues found.',
    });

    // 5. AntiGravity cannot self-certify completion: transition to validating_worker_output
    backgroundTaskManager.transition(task!.taskId, 'validating_worker_output', {
      currentStage: 'validating_worker_output',
      progressMessage: 'Validating AntiGravity worker execution evidence…',
    });

    const validatingState = backgroundTaskRepo.getTask(task!.taskId);
    expect(validatingState?.status).toBe('validating_worker_output');

    // 6. Control Plane CompletionContract verifies machine evidence
    const verifiedTask = backgroundTaskManager.verifyCompletion(task!.taskId, {
      resultText: 'Inspected repository state successfully. Verified clean git status and valid package.json.',
      readOnly: true,
      verificationNote: 'Inspection verified by control plane completion contract.',
    });

    expect(verifiedTask).toBeDefined();
    expect(verifiedTask?.status).toBe('completed');
    expect(verifiedTask?.verificationState).toBe('passed');

    // 7. Verify live console state exposes the entire sequence
    const consoleState = engineeringWorkerRegistry.getLiveConsoleState('antigravity');
    const taskSequence = consoleState.events
      .filter(e => e.taskId === task!.taskId)
      .map(e => e.eventType);

    expect(taskSequence).toContain('WORKER_ACCEPTED');
    expect(taskSequence).toContain('REPOSITORY_OPENED');
    expect(taskSequence).toContain('FILE_READ');
    expect(taskSequence).toContain('COMMAND_STARTED');
    expect(taskSequence).toContain('COMMAND_OUTPUT');
    expect(taskSequence).toContain('WORKER_DONE');
  });

  it('2. Verifies unified telemetry for Codex secondary/fallback worker under identical schema', async () => {
    const { task } = backgroundTaskManager.createTask({
      title: 'Codex Secondary Worker Validation',
      objective: 'Verify unified telemetry on secondary worker',
      originalRequest: 'Verify unified telemetry on secondary worker',
      route: '/jarvis',
      selectedAgent: 'Jarvis',
      worker: 'codex',
      projectId: 'proj-default',
      workspaceRoot: 'D:\\AgenticOS',
    });

    expect(task).toBeDefined();

    engineeringWorkerRegistry.recordWorkerEvent({
      taskId: task!.taskId,
      workerId: 'codex',
      eventType: 'WORKER_ACCEPTED',
    });

    engineeringWorkerRegistry.recordWorkerEvent({
      taskId: task!.taskId,
      workerId: 'codex',
      eventType: 'REPOSITORY_OPENED',
      file: 'D:\\AgenticOS',
    });

    engineeringWorkerRegistry.recordWorkerEvent({
      taskId: task!.taskId,
      workerId: 'codex',
      eventType: 'FILE_READ',
      file: 'D:\\AgenticOS\\tsconfig.json',
    });

    engineeringWorkerRegistry.recordWorkerEvent({
      taskId: task!.taskId,
      workerId: 'codex',
      eventType: 'WORKER_DONE',
    });

    const codexEvents = engineeringWorkerRegistry.getWorkerEvents('codex', 20);
    const related = codexEvents.filter(e => e.taskId === task!.taskId);
    expect(related.map(e => e.eventType)).toEqual([
      'WORKER_ACCEPTED',
      'REPOSITORY_OPENED',
      'FILE_READ',
      'WORKER_DONE',
    ]);
  });
});
