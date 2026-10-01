import { describe, it, expect } from 'vitest';
import { OperationalController, OperationalClaimGate } from '../domains/jarvis/operationalEvidence.js';
import { backgroundTaskManager } from '../services/backgroundTasks/manager.js';
import { backgroundTaskRepo } from '../services/backgroundTasks/store.js';

describe('Truthful Delegation & Free Cash Research Workflow Plan', () => {
  const convId = 'conv-free-cash-test-' + Date.now();

  it('creates and dispatches a visible Free Cash research workflow plan assigned to Hermes', async () => {
    const result = await OperationalController.handleOperationalRequest(
      'Create a Free Cash research workflow plan',
      convId
    );

    expect(result).not.toBeNull();
    expect(result!.evidence.hasEvidence).toBe(true);
    expect(result!.evidence.workerKind).toBe('hermes');
    expect(result!.evidence.taskState).toBe('running');
    expect(result!.reply).toContain('Free Cash research workflow plan');
    expect(result!.reply).toContain('assigned to Hermes');
    expect(result!.reply).toContain('Status: running');
    expect(result!.reply).toContain('current step: planning');
    expect(result!.reply).toContain('No completion is claimed');

    // Verify task exists in backgroundTaskRepo
    const taskId = result!.evidence.taskId!;
    const persisted = backgroundTaskRepo.getTask(taskId);
    expect(persisted).toBeDefined();
    expect(persisted!.worker).toBe('hermes');
    expect(persisted!.status).toBe('running');
    expect(persisted!.currentStage).toBe('planning');

    // Claim gate must verify the reply
    const verification = OperationalClaimGate.verifyClaims(result!.reply, convId, 'Create a Free Cash research workflow plan');
    expect(verification.ok).toBe(true);
  });

  it('blocks "I will delegate to Codex" when no Codex task exists in the conversation', () => {
    const emptyConv = 'conv-empty-delegation-' + Date.now();
    const claim = 'I will delegate this implementation to Codex now.';
    const verification = OperationalClaimGate.verifyClaims(claim, emptyConv);

    expect(verification.ok).toBe(false);
    expect(verification.response).toBe('No matching task exists.');
  });

  it('allows delegation claim when a matching worker task exists', () => {
    const activeConv = 'conv-active-delegation-' + Date.now();
    const { task } = backgroundTaskManager.createTask({
      title: 'Codex implementation task',
      objective: 'Run implementation',
      route: 'codex',
      worker: 'codex',
      priority: 'normal',
      conversationId: activeConv,
    });
    backgroundTaskManager.startTask(task!.taskId);

    const claim = `I will delegate to Codex to execute task ${task!.taskId}.`;
    const verification = OperationalClaimGate.verifyClaims(claim, activeConv);
    expect(verification.ok).toBe(true);
  });

  it('rejects "Codex completed successfully" when no verification evidence exists', () => {
    const testConv = 'conv-unverified-codex-' + Date.now();
    const { task } = backgroundTaskManager.createTask({
      title: 'Unverified task',
      objective: 'Do work',
      route: 'codex',
      worker: 'codex',
      priority: 'normal',
      conversationId: testConv,
    });
    backgroundTaskRepo.updateTask(task!.taskId, {
      status: 'completed',
      verificationState: 'unverified',
      resultText: '',
    });

    const claim = `Codex completed successfully on task ${task!.taskId}.`;
    const verification = OperationalClaimGate.verifyClaims(claim, testConv);
    expect(verification.ok).toBe(false);
    expect(verification.missingEvidence).toContain('without verified execution results');
  });

  it('allows "Codex completed successfully" when verified execution evidence exists', () => {
    const testConv = 'conv-verified-codex-' + Date.now();
    const { task } = backgroundTaskManager.createTask({
      title: 'Verified task',
      objective: 'Do work',
      route: 'codex',
      worker: 'codex',
      priority: 'normal',
      conversationId: testConv,
    });
    backgroundTaskRepo.updateTask(task!.taskId, {
      status: 'completed',
      verificationState: 'passed',
      resultText: 'All test cases passed cleanly with exit code 0.',
    });

    const claim = `Codex completed successfully on task ${task!.taskId}.`;
    const verification = OperationalClaimGate.verifyClaims(claim, testConv);
    expect(verification.ok).toBe(true);
  });
});
