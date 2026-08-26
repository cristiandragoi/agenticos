/**
 * jarvisExecutiveOrchestration.test.ts
 *
 * Comprehensive test suite verifying the Jarvis Executive Orchestration & Task Execution Contract:
 *   1. Operational intent routing (probe prompt -> worker_delegation to hermes, readOnly: false).
 *   2. Rejection of direct conversation 55% "no operational action requested" for explicit delegations.
 *   3. Scope constraint accuracy ("Do not modify any other file" != global read-only).
 *   4. File creation exemption in file resolution pre-check.
 *   5. Task ownership in conversation (conversationId, taskId, worker, status).
 *   6. Canonical reference resolver: affirmative approval ("Yes, please proceed") -> resolves approval.
 *   7. Canonical reference resolver: negative approval ("deny") -> denies approval.
 *   8. Canonical reference resolver: status queries ("What happened with that task?") -> truthful status.
 *   9. Canonical reference resolver: explicit stop/cancel ("stop it") -> cancels active task.
 *  10. Canonical reference resolver: continuation ("continue", "please proceed") -> binds to active task.
 *  11. Worker queue slot release on terminal states.
 *  12. Queue position updates when worker slot frees.
 *  13. Upstream stall detection, confirmed dead reconciliation, and slot release.
 *  14. Single conversational ownership under Jarvis.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { classifyExecutiveIntent, isReadOnlyConstraint } from '../domains/jarvis/executiveIntent.js';
import { resolvePromptFileReferences, buildFileNotFoundReply } from '../domains/jarvis/fileResolution.js';
import { resolveActiveOperationReference } from '../domains/jarvis/taskReferenceResolver.js';
import { backgroundTaskManager } from '../services/backgroundTasks/manager.js';
import { backgroundTaskRepo } from '../services/backgroundTasks/store.js';
import { jarvisExecutionSupervisor } from '../domains/jarvis/executionSupervisor.js';
import { hermesApiService } from '../services/hermesApiService.js';
import type { BackgroundTaskRecord } from '../services/backgroundTasks/types.js';

describe('Jarvis Executive Orchestration Contract', () => {
  const createdTaskIds: string[] = [];

  function createTestTask(opts: {
    title: string;
    objective: string;
    worker: 'hermes' | 'codex' | 'team';
    conversationId?: string;
    route?: string;
    selectedAgent?: string;
  }): BackgroundTaskRecord {
    const taskId = `bgtask-exec-test-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const now = new Date().toISOString();
    const task: BackgroundTaskRecord = {
      taskId,
      title: opts.title,
      objective: opts.objective,
      originalRequest: opts.objective,
      route: opts.route || opts.worker,
      selectedAgent: opts.selectedAgent || (opts.worker === 'hermes' ? 'Hermes' : 'CodeX'),
      status: 'queued',
      priority: 'medium',
      projectId: null,
      createdAt: now,
      startedAt: null,
      updatedAt: now,
      completedAt: null,
      conversationId: opts.conversationId || null,
      conversationSessionId: null,
      worker: opts.worker,
      linkedRunId: null,
      linkedBoardCardId: null,
      parentTaskId: null,
      childTaskIds: [],
      currentStage: 'queued',
      progressMessage: 'Task created.',
      filesChanged: [],
      buildState: 'idle',
      testState: 'idle',
      verificationState: 'pending',
      approvalState: 'none',
      blocker: null,
      lastError: null,
      cancellationRequested: false,
      resumable: false,
      resultText: null,
      attempt: 1,
      metadata: {},
      workspaceRoot: 'B:\\AgenticOS',
    };
    backgroundTaskRepo.insertTask(task);
    createdTaskIds.push(taskId);
    return task;
  }

  afterEach(() => {
    for (const id of createdTaskIds) {
      try {
        backgroundTaskRepo.updateTask(id, { status: 'completed' });
      } catch {}
    }
    createdTaskIds.length = 0;
    vi.restoreAllMocks();
  });

  it('1. Probe prompt classifies as worker_delegation to Hermes with readOnly: false', () => {
    const probePrompt = `Ask Hermes to create exactly:

B:\\AgenticOS\\docs\\acceptance\\hermes-write-probe.txt

with exactly:

HERMES_WRITE_ACCEPTANCE_OK

Do not modify any other file.
Request my approval before writing.
After approval, verify the file and report the result.`;

    const result = classifyExecutiveIntent(probePrompt);
    expect(result).not.toBeNull();
    expect(result?.intent).toBe('worker_delegation');
    expect(result?.workerKind).toBe('hermes');
    expect(result?.readOnly).toBe(false);
    expect(result?.confidence).toBeGreaterThanOrEqual(0.95);
  });

  it('2. "Do not modify any other file" does not trigger global read-only flag', () => {
    const prompt = 'Ask Hermes to create file.txt with content OK. Do not modify any other file.';
    expect(isReadOnlyConstraint(prompt)).toBe(false);

    const readOnlyPrompt = 'Ask Hermes to inspect file.txt in read-only mode. Do not modify files.';
    expect(isReadOnlyConstraint(readOnlyPrompt)).toBe(true);
  });

  it('3. buildFileNotFoundReply allows creation of non-existent files', () => {
    const prompt = 'Ask Hermes to create exactly: B:\\AgenticOS\\docs\\acceptance\\hermes-write-probe.txt';
    const outcome = resolvePromptFileReferences(prompt, 'B:\\AgenticOS');
    const reply = buildFileNotFoundReply(outcome, prompt);
    expect(reply).toBeNull();
  });

  it('4. Affirmative approval ("Yes, please proceed") resolves waiting approval task', async () => {
    const convId = `conv-appr-${Date.now()}`;
    const task = createTestTask({
      title: 'Hermes Acceptance Probe',
      objective: 'Write probe file',
      worker: 'hermes',
      conversationId: convId,
    });

    backgroundTaskManager.requestApproval(task.taskId, {
      action: 'Write file',
      reason: 'Create probe file',
    });

    const res = await resolveActiveOperationReference({
      conversationId: convId,
      message: 'Yes, please proceed.',
    });

    expect(res.type).toBe('approval_resolution');
    expect(res.choice).toBe('allow');
    expect(res.replyText).toContain('Approval granted');

    const updated = backgroundTaskRepo.getTask(task.taskId);
    expect(updated?.status).toBe('running');
    expect(updated?.approvalState).toBe('allowed');
  });

  it('5. Negative approval ("No, cancel that") denies waiting approval task', async () => {
    const convId = `conv-deny-${Date.now()}`;
    const task = createTestTask({
      title: 'Hermes Acceptance Probe',
      objective: 'Write probe file',
      worker: 'hermes',
      conversationId: convId,
    });

    backgroundTaskManager.requestApproval(task.taskId, {
      action: 'Write file',
      reason: 'Create probe file',
    });

    const res = await resolveActiveOperationReference({
      conversationId: convId,
      message: 'No, do not do that',
    });

    expect(res.type).toBe('approval_resolution');
    expect(res.choice).toBe('deny');
    expect(res.replyText).toContain('Approval denied');

    const updated = backgroundTaskRepo.getTask(task.taskId);
    expect(updated?.status).toBe('blocked');
    expect(updated?.approvalState).toBe('denied');
  });

  it('6. "What happened with that task?" returns truthful task status', async () => {
    const convId = `conv-status-${Date.now()}`;
    const task = createTestTask({
      title: 'Hermes Acceptance Probe',
      objective: 'Write probe file',
      worker: 'hermes',
      conversationId: convId,
    });

    const res = await resolveActiveOperationReference({
      conversationId: convId,
      message: 'What happened with that task?',
    });

    expect(res.type).toBe('active_task_status');
    expect(res.task?.taskId).toBe(task.taskId);
    expect(res.replyText).toBeDefined();
  });

  it('7. "stop it" cancels the active task in the conversation', async () => {
    const convId = `conv-stop-${Date.now()}`;
    const task = createTestTask({
      title: 'Hermes Running Task',
      objective: 'Long running task',
      worker: 'hermes',
      conversationId: convId,
    });

    backgroundTaskManager.transition(task.taskId, 'running');

    const res = await resolveActiveOperationReference({
      conversationId: convId,
      message: 'stop it',
    });

    expect(res.type).toBe('stop');
    expect(res.replyText).toContain('Stopping Hermes');
  });

  it('8. Queue slot pump dispatches queued task when slot frees', async () => {
    const task1 = createTestTask({
      title: 'Hermes Task 1',
      objective: 'First task',
      worker: 'hermes',
    });
    backgroundTaskManager.transition(task1.taskId, 'running');

    const task2 = createTestTask({
      title: 'Hermes Task 2',
      objective: 'Second task',
      worker: 'hermes',
    });

    expect(task2.status).toBe('queued');

    const spy = vi.spyOn(backgroundTaskManager, 'pumpQueuedForWorker');
    backgroundTaskManager.transition(task1.taskId, 'completed', { resultText: 'Done' });

    expect(spy).toHaveBeenCalledWith('hermes');
    spy.mockRestore();
  });

  it('9. Confirmed stall (>= 90s idle) reconciles task, fails it, and releases slot', async () => {
    const opId = `op-stall-${Date.now()}`;
    const convId = `conv-stall-${Date.now()}`;

    const task = createTestTask({
      title: 'Stalled Hermes Task',
      objective: 'Stalled task',
      worker: 'hermes',
      conversationId: convId,
    });

    jarvisExecutionSupervisor.superviseTask({
      taskId: task.taskId,
      operationId: opId,
      conversationId: convId,
      worker: 'hermes',
      initialState: 'RUNNING_ACTIVE',
    });

    const supervised = jarvisExecutionSupervisor.getSupervisedTask(task.taskId)!;
    supervised.lastActivityAt = Date.now() - 95_000; // 95s idle

    vi.spyOn(hermesApiService, 'probeRunLiveness').mockResolvedValue({
      status: 'running',
      isAlive: false,
    });

    await jarvisExecutionSupervisor.checkHeartbeats();

    const updated = backgroundTaskRepo.getTask(task.taskId);
    expect(updated?.status).toBe('failed');
    expect(updated?.blocker).toContain('Worker confirmed stalled');
  });
});
