import { describe, it, expect } from 'vitest';
import { handleUserCorrection, simulateArgusVerification } from '../services/recoveryManager.js';

const mockGoalRun = {
  id: 'goal-1790545900080-d92z0',
  turnId: 'turn-1790372862069',
  goal: 'browser.search_and_open'
} as any;

describe('Recovery Path Repairs', () => {
  it('handles user correction and transitions to RECOVERING state', async () => {
    const currentGoal = mockGoalRun;
    const correctionText = 'That result is wrong. Continue the exact GoalRun.';

    const recoveryStep = handleUserCorrection(currentGoal, correctionText);

    expect(recoveryStep.state).toBe('RECOVERING');
    expect(recoveryStep.originalGoalId).toBe(currentGoal.id);
    expect(recoveryStep.attemptedAction).toContain('camera.perceive_retry');
    expect(recoveryStep.recoveryPath[0]).toBe('1. Transition GoalRun to RECOVERING state (persist original goal ID)');
  });

  it('verifies Argus passes with repaired goal run', () => {
    const verification = simulateArgusVerification(mockGoalRun);
    expect(verification.verified).toBe(true);
    expect(verification.reason).toContain('Fresh camera-frame metadata bound');
  });
});
import { describe, it, expect, beforeEach } from 'vitest';
import { handleUserCorrection, simulateArgusVerification } from '../services/recoveryManager.js';

const mockGoalRun = {
  id: 'goal-1790545900080-d92z0',
  turnId: 'turn-1790372862069',
  goal: 'browser.search_and_open'
};

describe('Recovery Path Repairs', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('handles user correction and transitions to RECOVERING state', () => {
    const currentGoal = mockGoalRun;
    const correctionText = 'That result is wrong. Continue the exact GoalRun.';

    // Re-import after reset
    const { handleUserCorrection } = require('../services/recoveryManager');

    const recoveryStep = handleUserCorrection(currentGoal, correctionText);

    expect(recoveryStep.state).toBe('RECOVERING');
    expect(recoveryStep.originalGoalId).toBe(currentGoal.id);
    expect(recoveryStep.attemptedAction).toContain('camera.perceive_retry');
    expect(recoveryStep.recoveryPath[0]).toBe('1. Transition GoalRun to RECOVERING state (persist original goal ID)');
  });

  it('verifies Argus passes with repaired goal run', () => {
    const verification = simulateArgusVerification(mockGoalRun);
    expect(verification.verified).toBe(true);
    expect(verification.reason).toContain('Fresh camera-frame metadata bound');
  });
});