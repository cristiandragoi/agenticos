import { describe, it, expect, vi, beforeEach } from 'vitest';
import { jarvisNextAgent } from '../domains/jarvisNext/jarvisNextAgent.js';

describe('Watchdog Lifecycle Decoupling Suite (Requirement H)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('proves verified execution success is never converted into application timeout during speech playout', async () => {
    const agent = jarvisNextAgent as any;
    const testTurnId = 888;

    // 1. Simulate verified execution result
    agent.lastVerifiedExecutionResult = {
      turnId: testTurnId,
      action: 'READ_MESSAGES',
      resultText: 'The last 4 messages in Telegram are received.',
      verified: true,
      deliveryStatus: 'PENDING',
    };

    // 2. Disarm execution watchdog on execution completion
    agent.disarmExecutionWatchdog(testTurnId, 'verified_execution_completed');
    expect(agent.executionCompletedTurns.has(testTurnId)).toBe(true);

    // 3. Spy on broadcastData & speak to detect if timeout announcement ever gets emitted
    const broadcastSpy = vi.spyOn(agent, 'broadcastData');
    const speakSpy = vi.spyOn(agent, 'speak').mockResolvedValue(undefined as any);

    // 4. Force call onTurnWatchdogExpired simulating a late watchdog fire during audio playout
    await agent.onTurnWatchdogExpired(testTurnId, 'test-conv');

    // 5. Verify that NO application timeout was broadcasted or spoken
    const calls = broadcastSpy.mock.calls.map(c => c[0]);
    const timeoutAnnouncement = calls.find(
      (c: any) => c.text && c.text.includes('timed out while waiting for the application to respond')
    );
    expect(timeoutAnnouncement).toBeUndefined();

    // Verify speak was not called with timeout message
    const spoken = speakSpy.mock.calls.map(c => c[0]);
    const spokenTimeout = spoken.find(
      (s: any) => typeof s === 'string' && s.includes('timed out while waiting for the application to respond')
    );
    expect(spokenTimeout).toBeUndefined();

    // 6. Verify verified execution result was PRESERVED
    expect(agent.lastVerifiedExecutionResult.verified).toBe(true);
    expect(agent.lastVerifiedExecutionResult.action).toBe('READ_MESSAGES');
  });

  it('execution watchdog only triggers timeout if execution was genuinely uncompleted', async () => {
    const agent = jarvisNextAgent as any;
    const uncompletedTurnId = 999;

    agent.lastVerifiedExecutionResult = null;
    agent.executionCompletedTurns.delete(uncompletedTurnId);

    const broadcastSpy = vi.spyOn(agent, 'broadcastData');
    vi.spyOn(agent, 'speak').mockResolvedValue(undefined as any);

    await agent.onTurnWatchdogExpired(uncompletedTurnId, 'test-conv');

    const calls = broadcastSpy.mock.calls.map(c => c[0]);
    const timeoutAnnouncement = calls.find(
      (c: any) => c.text && c.text.includes('timed out while waiting for the application to respond')
    );
    expect(timeoutAnnouncement).toBeDefined();
  });

  it('guarantees semantic latency does NOT reduce physical execution watchdog budget (Repair 2)', () => {
    const agent = jarvisNextAgent as any;
    const testTurnId = 777;

    // Simulate turn latch acquired 8 seconds ago (e.g. STT + semantic interpretation consumed 8s)
    const t0 = Date.now() - 8000;
    agent.turnLatchAcquiredAt = t0;
    agent.isProcessingUserTurn = true;
    agent.lifecycleRequestInFlight = true;

    // Spy on setTimeout to capture watchdog budget
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');

    // Arm watchdog at EXECUTION_DISPATCHED
    agent.armExecutionWatchdog(testTurnId, 'test-conv', 12_000);

    // Watchdog MUST be armed for the full 12,000ms, NOT reduced by the 8000ms already elapsed!
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 12_000);

    // Clean up
    agent.disarmExecutionWatchdog(testTurnId, 'test_cleanup');
  });

  it('proves execution watchdog does NOT fire at wall-clock 12s if execution was dispatched later', async () => {
    const agent = jarvisNextAgent as any;
    const testTurnId = 555;

    agent.isProcessingUserTurn = true;
    agent.lifecycleRequestInFlight = true;
    agent.executionCompletedTurns.delete(testTurnId);
    agent.lastVerifiedExecutionResult = null;

    const expiredSpy = vi.spyOn(agent, 'onTurnWatchdogExpired').mockResolvedValue(undefined);

    // Arm execution watchdog with 12_000ms
    agent.armExecutionWatchdog(testTurnId, 'test-conv', 12_000);

    // After 8s (e.g. wall clock when old global timer would be near expiration), execution watchdog has NOT fired
    expect(expiredSpy).not.toHaveBeenCalled();

    // Clean up
    agent.disarmExecutionWatchdog(testTurnId, 'test_cleanup');
  });
});

