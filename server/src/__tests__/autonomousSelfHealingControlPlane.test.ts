import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { autonomousRecoveryEngine } from '../domains/controlPlane/AutonomousRecoveryEngine.js';
import { goalLifecycleManager } from '../domains/controlPlane/GoalLifecycle.js';
import { engineeringDelegationService } from '../domains/controlPlane/EngineeringDelegationService.js';
import { speechArbiter, SpeechPriority } from '../domains/jarvisNext/speechArbiter.js';
import { argusService } from '../domains/controlPlane/ArgusService.js';
import { engineeringWorkerRegistry } from '../domains/controlPlane/EngineeringWorkerRegistry.js';
import type { GoalAttempt } from '../domains/controlPlane/types.js';

describe('Autonomous Self-Healing Control Plane', () => {
  const speechHistory: string[] = [];
  let savedRepairEnv: string | undefined;

  beforeEach(() => {
    speechHistory.length = 0;
    // Enable the Phase 1 guard for this suite. The guard is a production deployment gate; tests
    // must verify the real pipeline behavior. Save and restore to preserve isolation.
    savedRepairEnv = process.env.AGENTICOS_AUTONOMOUS_ENGINEERING_REPAIR;
    process.env.AGENTICOS_AUTONOMOUS_ENGINEERING_REPAIR = '1';
    // Register spy on speechArbiter
    speechArbiter.register({
      speakFn: async (text: string) => {
        speechHistory.push(text);
      },
      getCurrentTurnId: () => 1,
      isUserTurnActive: () => true,
    });
  });

  afterEach(() => {
    if (savedRepairEnv === undefined) {
      delete process.env.AGENTICOS_AUTONOMOUS_ENGINEERING_REPAIR;
    } else {
      process.env.AGENTICOS_AUTONOMOUS_ENGINEERING_REPAIR = savedRepairEnv;
    }
    vi.restoreAllMocks();
  });

  it('executes full autonomous recovery loop with 4 canonical spoken stages without user prompting', async () => {
    // 1. Setup durable GoalRun
    const originalCommand = 'open Word and create a blank document';
    const goal = goalLifecycleManager.startGoal({
      conversationId: 'test-conv-selfheal',
      turnId: '1',
      userInput: originalCommand,
      normalizedGoal: originalCommand,
      target: 'Word and create a blank document',
    });

    const failedAttempt: GoalAttempt = {
      attemptNumber: 1,
      strategy: 'start_menu:Word',
      surface: 'desktop',
      target: 'Word and create a blank document',
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      executed: false,
      verified: false,
      evidence: [],
      error: 'Failed to create document in Word',
    };

    // Spy on engineeringDelegationService
    const delegateSpy = vi.spyOn(engineeringDelegationService, 'delegateTask').mockResolvedValueOnce({
      success: true,
      taskId: 'bgtask-selfheal-word-1',
      goalId: goal.goalId,
      worker: 'antigravity',
      status: 'running',
      accepted: true,
      runId: 'conv-ag-session-123',
      conversationId: 'conv-ag-session-123',
      hasWorkerAccepted: true,
      objective: 'Repair Word blank document capability',
      workspace: 'D:\\AgenticOS',
      message: 'AntiGravity accepted task bgtask-selfheal-word-1',
    });

    // Spy on Argus verification
    const verifySpy = vi.spyOn(argusService, 'verifyExecution').mockResolvedValueOnce({
      verified: true,
      method: 'ArgusIndependentVerifier',
      expectedState: { documentCreated: true },
      actualState: { documentCreated: true, docx: 'Document1.docx' },
      evidence: [{
        id: 'ev-1',
        type: 'process',
        label: 'Active Word Document Document1',
        value: { MainWindowTitle: 'Document1 - Word' },
        source: 'Argus',
        timestamp: new Date().toISOString(),
        verified: true,
      }],
      verifier: 'Argus',
      timestamp: new Date().toISOString(),
      summary: 'Verified Word document exists.',
    });

    let retryCalled = false;
    const outcome = await autonomousRecoveryEngine.handleFailure({
      goalId: goal.goalId,
      failedAttempt,
      target: 'Word and create a blank document',
      goalType: 'open',
      verb: 'open',
      executeStrategy: async () => {
        retryCalled = true;
        return { executed: true };
      },
    });

    // Assertions
    expect(outcome.success).toBe(true);
    expect(outcome.status).toBe('COMPLETED');
    expect(retryCalled).toBe(true);

    // Verify Delegation
    expect(delegateSpy).toHaveBeenCalled();
    const delegateArgs = delegateSpy.mock.calls[0][0];
    expect(delegateArgs.worker).toBe('antigravity');
    expect(delegateArgs.workspacePath).toBe('D:\\AgenticOS');
    expect(delegateArgs.objective).toContain(originalCommand);
    expect(delegateArgs.objective).toContain('npm test');
    expect(delegateArgs.objective).toContain('npm run build:app');
    expect(delegateArgs.objective).toContain('scripts/deploy-installed.cjs');

    // Verify Spoken Lifecycle Feedback (All 4 Canonical Stages)
    expect(speechHistory).toContain('That action failed. I’m sending the repair to AntiGravity.');
    expect(speechHistory).toContain('AntiGravity accepted the repair and is working on it.');
    expect(speechHistory).toContain('It found the issue and is rebuilding/deploying/retrying.');
    expect(speechHistory).toContain('The repair is complete and verified.');

    // Verify GoalRun preserved and completed
    const updatedGoal = goalLifecycleManager.getGoalRun(goal.goalId);
    expect(updatedGoal?.originalUserInput).toBe(originalCommand);
    expect(updatedGoal?.status).toBe('COMPLETED');
    expect(updatedGoal?.finalVerification?.verified).toBe(true);
  });

  it('continues the SAME task ID if first verification after repair fails', async () => {
    const originalCommand = 'take a screenshot';
    const goal = goalLifecycleManager.startGoal({
      conversationId: 'test-conv-screenshot-continue',
      turnId: '2',
      userInput: originalCommand,
      normalizedGoal: originalCommand,
      target: 'screenshot',
    });

    const failedAttempt: GoalAttempt = {
      attemptNumber: 1,
      strategy: 'screen.capture',
      surface: 'screenshot',
      target: 'screenshot',
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      executed: false,
      verified: false,
      evidence: [],
      error: 'Screenshot capture failed: display handle invalid',
    };

    const targetTaskId = 'bgtask-screenshot-007';

    vi.spyOn(engineeringDelegationService, 'delegateTask').mockResolvedValueOnce({
      success: true,
      taskId: targetTaskId,
      goalId: goal.goalId,
      worker: 'antigravity',
      status: 'running',
      accepted: true,
      runId: 'conv-shot-session',
      hasWorkerAccepted: true,
      objective: 'Repair screenshot capability',
      workspace: 'D:\\AgenticOS',
      message: 'Worker accepted',
    });

    const continueSpy = vi.spyOn(engineeringDelegationService, 'continueTask').mockResolvedValueOnce({
      success: true,
      taskId: targetTaskId,
      worker: 'antigravity',
      status: 'executing',
      continued: true,
      message: `Task ${targetTaskId} continued.`,
    });

    // First post-repair verification fails, second succeeds on continuation
    vi.spyOn(argusService, 'verifyExecution')
      .mockResolvedValueOnce({
        verified: false,
        method: 'ArgusIndependentVerifier',
        expectedState: { minBytes: 1024 },
        actualState: null,
        evidence: [],
        verifier: 'Argus',
        timestamp: new Date().toISOString(),
        summary: 'Screenshot artifact missing or file does not exist on disk',
      })
      .mockResolvedValueOnce({
        verified: true,
        method: 'ArgusIndependentVerifier',
        expectedState: { minBytes: 1024 },
        actualState: { byteSize: 54321, artifactPath: 'D:\\temp\\screenshot.png' },
        evidence: [{
          id: 'ev-shot-real',
          type: 'screenshot',
          label: 'Real Screenshot Artifact',
          value: { byteSize: 54321, sha256: 'a'.repeat(64) },
          source: 'Argus',
          timestamp: new Date().toISOString(),
          verified: true,
        }],
        verifier: 'Argus',
        timestamp: new Date().toISOString(),
        summary: 'Screenshot artifact verified on disk (54321 bytes).',
      });

    const outcome = await autonomousRecoveryEngine.handleFailure({
      goalId: goal.goalId,
      failedAttempt,
      target: 'screenshot',
      goalType: 'capture_screenshot',
      verb: 'capture_screenshot',
      executeStrategy: async () => ({ executed: true }),
    });

    expect(outcome.success).toBe(true);
    expect(outcome.status).toBe('COMPLETED');

    // Strict contract: MUST continue the SAME task ID!
    expect(continueSpy).toHaveBeenCalledWith(expect.objectContaining({
      taskId: targetTaskId,
    }));
  });
});
