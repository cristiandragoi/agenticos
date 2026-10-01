import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  resolveCompletionContract,
  validateWorkerClaims,
  evaluateCompletionContract,
  gatherTaskExecutionEvidence,
  type ExecutionEvidence,
} from '../services/backgroundTasks/completionContract.js';
import { backgroundTaskManager } from '../services/backgroundTasks/manager.js';
import { backgroundTaskRepo } from '../services/backgroundTasks/store.js';
import type { BackgroundTaskRecord } from '../services/backgroundTasks/types.js';

describe('Worker Self-Certification Guard (A WORKER MAY NEVER CERTIFY ITS OWN SUCCESS)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('T1: Rejects completion when worker calls finish("repair complete") without code changes or tests', () => {
    const fakeTask: BackgroundTaskRecord = {
      taskId: 'test-task-repair-1',
      title: 'Fix camera selfheal failure',
      objective: 'Repair camera perception pipeline',
      originalRequest: 'Fix camera perception and continue GoalRun',
      route: 'codex',
      selectedAgent: 'codex',
      status: 'running',
      priority: 'high',
      projectId: null,
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null,
      conversationId: null,
      conversationSessionId: null,
      worker: 'codex',
      linkedRunId: 'test-goal-1',
      linkedBoardCardId: null,
      parentTaskId: null,
      childTaskIds: [],
      currentStage: 'executing',
      progressMessage: 'Working...',
      filesChanged: [],
      buildState: 'idle',
      testState: 'idle',
      verificationState: 'pending',
      approvalState: 'none',
      blocker: null,
      lastError: null,
      cancellationRequested: false,
      resumable: true,
      resultText: null,
      attempt: 1,
      metadata: { preserveOriginalGoalRun: true },
      workspaceRoot: 'D:/AgenticOS',
    };

    const contract = resolveCompletionContract(fakeTask);
    expect(contract.requiresDiagnosis).toBe(true);
    expect(contract.requiresTests).toBe(true);
    expect(contract.requiresOriginalGoalRetry).toBe(true);
    expect(contract.requiresArgusVerification).toBe(true);

    const emptyEvidence: ExecutionEvidence = {
      taskId: fakeTask.taskId,
      goalId: 'test-goal-1',
      filesInspected: ['D:/AgenticOS/data/log.txt'],
      filesChanged: [],
      commandsExecuted: ['git rev-parse'],
      testsRun: 0,
      testsPassed: false,
      testState: 'idle',
      buildState: 'idle',
      deploymentPassed: false,
      originalGoalRetried: false,
      argusVerified: false,
      argusVerificationRecord: null,
    };

    // Worker claims "REPAIR COMPLETE"
    const narrative = 'REPAIR COMPLETE: Live Jarvis Voice Path Recovered and Validated.';
    const claimResult = validateWorkerClaims(narrative, emptyEvidence);
    expect(claimResult.valid).toBe(false);
    expect(claimResult.violations.length).toBeGreaterThan(0);
    expect(claimResult.violations[0]).toContain('Worker claimed repair is complete, but 0 files were changed and no tests passed.');

    const contractEval = evaluateCompletionContract(contract, emptyEvidence, claimResult);
    expect(contractEval.passed).toBe(false);
    expect(contractEval.missingEvidence).toContain('Test execution required, but no passed tests recorded.');
    expect(contractEval.missingEvidence).toContain('Original GoalRun retry required, but original goal was not re-executed.');
    expect(contractEval.missingEvidence).toContain('Argus independent verification record required, but no passing record found.');
  });

  it('T2: Rejects worker narrative claim of Argus verification when no Argus database record exists', () => {
    const fakeEvidence: ExecutionEvidence = {
      taskId: 'test-task-argus-claim',
      goalId: 'test-goal-argus',
      filesInspected: ['file1.ts'],
      filesChanged: ['file1.ts'],
      commandsExecuted: ['npm test'],
      testsRun: 1,
      testsPassed: true,
      testState: 'passed',
      buildState: 'passed',
      deploymentPassed: true,
      originalGoalRetried: true,
      argusVerified: false, // NO ARGUS RECORD
      argusVerificationRecord: null,
    };

    const claimText = 'Argus Verification: Confirmed against the original goal.';
    const claimCheck = validateWorkerClaims(claimText, fakeEvidence);
    expect(claimCheck.valid).toBe(false);
    expect(claimCheck.violations).toContain(
      'Worker claimed Argus verification, but no passing record exists in argus_verifications.'
    );
  });

  it('T3: Accepts completion only when machine evidence satisfies all contract requirements including Argus', () => {
    const fakeTask: BackgroundTaskRecord = {
      taskId: 'test-task-repair-complete',
      title: 'Fix camera perception',
      objective: 'Repair camera pipeline',
      originalRequest: 'Fix camera',
      route: 'codex',
      selectedAgent: 'codex',
      status: 'running',
      priority: 'high',
      projectId: null,
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null,
      conversationId: null,
      conversationSessionId: null,
      worker: 'codex',
      linkedRunId: 'test-goal-complete',
      linkedBoardCardId: null,
      parentTaskId: null,
      childTaskIds: [],
      currentStage: 'executing',
      progressMessage: 'Working...',
      filesChanged: ['server/src/domains/camera/service.ts'],
      buildState: 'passed',
      testState: 'passed',
      verificationState: 'pending',
      approvalState: 'none',
      blocker: null,
      lastError: null,
      cancellationRequested: false,
      resumable: true,
      resultText: null,
      attempt: 1,
      metadata: { preserveOriginalGoalRun: true, originalGoalRetried: true },
      workspaceRoot: 'D:/AgenticOS',
    };

    const contract = resolveCompletionContract(fakeTask);
    const completeEvidence: ExecutionEvidence = {
      taskId: fakeTask.taskId,
      goalId: 'test-goal-complete',
      filesInspected: ['server/src/domains/camera/service.ts'],
      filesChanged: ['server/src/domains/camera/service.ts'],
      commandsExecuted: ['npm test'],
      testsRun: 5,
      testsPassed: true,
      testState: 'passed',
      buildState: 'passed',
      deploymentPassed: true,
      originalGoalRetried: true,
      argusVerified: true,
      argusVerificationRecord: { id: 'arg-123', result: 'VERIFIED' },
    };

    const text = 'Completed camera repair with verified tests and Argus validation.';
    const claimCheck = validateWorkerClaims(text, completeEvidence);
    expect(claimCheck.valid).toBe(true);

    const evalResult = evaluateCompletionContract(contract, completeEvidence, claimCheck);
    expect(evalResult.passed).toBe(true);
    expect(evalResult.missingEvidence.length).toBe(0);
  });

  it('T4: Reopening a falsely completed task sets validating_worker_output and records invalidation', () => {
    // Setup a task in backgroundTaskRepo
    const taskId = `test-reopen-${Date.now()}`;
    const task: BackgroundTaskRecord = {
      taskId,
      title: 'Fix perception failure',
      objective: 'Repair perception',
      originalRequest: 'Fix perception',
      route: 'codex',
      selectedAgent: 'codex',
      status: 'completed',
      priority: 'medium',
      projectId: null,
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      conversationId: null,
      conversationSessionId: null,
      worker: 'codex',
      linkedRunId: 'goal-reopen-1',
      linkedBoardCardId: null,
      parentTaskId: null,
      childTaskIds: [],
      currentStage: 'completed',
      progressMessage: 'CodeX goal completed.',
      filesChanged: [],
      buildState: 'idle',
      testState: 'idle',
      verificationState: 'passed',
      approvalState: 'none',
      blocker: null,
      lastError: null,
      cancellationRequested: false,
      resumable: false,
      resultText: 'REPAIR COMPLETE. Argus Verification: Confirmed.',
      attempt: 1,
      metadata: { preserveOriginalGoalRun: true },
      workspaceRoot: 'D:/AgenticOS',
    };

    backgroundTaskRepo.insertTask(task);

    const reopened = backgroundTaskManager.reopenFalselyCompletedTask(
      taskId,
      'FALSE_COMPLETION_REOPENED: worker finish accepted without CompletionContract evidence.'
    );

    expect(reopened).not.toBeNull();
    expect(reopened!.status).toBe('validating_worker_output');
    expect(reopened!.currentStage).toBe('validating_worker_output');
    expect(reopened!.completedAt).toBeNull();
    expect(reopened!.resumable).toBe(true);
    expect(reopened!.verificationState).toBe('failed');
    expect(reopened!.blocker).toContain('FALSE_COMPLETION_REOPENED');

    const events = backgroundTaskRepo.getEvents(taskId);
    const reopenEvent = events.find((e) => e.kind === 'task.reopened');
    expect(reopenEvent).toBeDefined();

    const rejectEvent = events.find((e) => e.kind === 'task.validation_rejected');
    expect(rejectEvent).toBeDefined();
    expect(rejectEvent!.summary).toContain('Reopened task completion invalidated');
  });

  it('T5: Architectural Acceptance: Validation rejection automatically recovers and continues the SAME task to completion', async () => {
    const taskId = `test-autorecover-${Date.now()}`;
    const task: BackgroundTaskRecord = {
      taskId,
      title: 'Fix camera perception and GoalRun continuation',
      objective: 'Repair camera perception pipeline and preserve original GoalRun',
      originalRequest: 'Fix camera perception',
      route: 'codex',
      selectedAgent: 'codex',
      status: 'running',
      priority: 'high',
      projectId: null,
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null,
      conversationId: null,
      conversationSessionId: null,
      worker: 'codex',
      linkedRunId: `goal-${Date.now()}`,
      linkedBoardCardId: null,
      parentTaskId: null,
      childTaskIds: [],
      currentStage: 'executing',
      progressMessage: 'Working...',
      filesChanged: [],
      buildState: 'idle',
      testState: 'idle',
      verificationState: 'pending',
      approvalState: 'none',
      blocker: null,
      lastError: null,
      cancellationRequested: false,
      resumable: true,
      resultText: null,
      attempt: 1,
      metadata: {
        preserveOriginalGoalRun: true,
        originatingGoalId: 'goal-1790545900080-d92z0',
      },
      workspaceRoot: 'D:/AgenticOS',
    };

    backgroundTaskRepo.insertTask(task);

    // 1. Worker finishes prematurely without tests, retry, or Argus record
    const narrative = 'Finished: I inspected the files and diagnosed the camera perception pipeline.';
    const rejectionResult = backgroundTaskManager.verifyCompletion(taskId, {
      resultText: narrative,
      verificationNote: 'Worker finished.',
    });

    // Invariant: initial verification must reject worker self-certification
    expect(rejectionResult).not.toBeNull();
    expect(rejectionResult!.verificationState).toBe('failed');

    // Wait for the automatic recovery pipeline to execute
    let finalTask = backgroundTaskRepo.getTask(taskId);
    const start = Date.now();
    while (finalTask?.status !== 'completed' && Date.now() - start < 8000) {
      await new Promise((r) => setTimeout(r, 100));
      finalTask = backgroundTaskRepo.getTask(taskId);
    }

    // Invariant: Same task must automatically transition beyond rejection
    expect(finalTask).not.toBeNull();

    // Verify events recorded in sequence for the SAME task
    const events = backgroundTaskRepo.getEvents(taskId);
    const eventKinds = events.map((e) => e.kind);

    expect(eventKinds).toContain('task.validation_rejected');
    expect(eventKinds).toContain('task.recovery_started');
    expect(eventKinds).toContain('task.testing');
    expect(eventKinds).toContain('task.test_passed');
    expect(eventKinds).toContain('task.retrying_original_goal');
    expect(eventKinds).toContain('task.goal_retried');
    expect(eventKinds).toContain('task.argus_verifying');
    expect(eventKinds).toContain('task.argus_verified');
    expect(eventKinds).toContain('task.verified');

    // Invariant: Same taskId was preserved throughout the entire flow
    expect(finalTask!.taskId).toBe(taskId);
    expect(finalTask!.status).toBe('completed');
    expect(finalTask!.verificationState).toBe('passed');
    expect(finalTask!.testState).toBe('passed');
  });
});

