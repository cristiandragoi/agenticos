import { describe, it, expect } from 'vitest';
import { isGoalActivelyRunning } from '../presenters/executionStatus';

describe('isGoalActivelyRunning (persisted QUEUED vs actual runtime execution)', () => {
  const now = Date.now();

  it('is true for loop-driven statuses (planning/executing/reasoning/retrying)', () => {
    for (const status of ['planning', 'executing', 'reasoning', 'retrying']) {
      expect(isGoalActivelyRunning({ status })).toBe(true);
    }
  });

  it('is true for QUEUED with a live worker lease', () => {
    expect(isGoalActivelyRunning({
      status: 'queued',
      workerId: 'w1',
      leaseExpiresAt: String(now + 60_000),
    })).toBe(true);
  });

  it('is false for QUEUED with no lease (the stale zombie case)', () => {
    expect(isGoalActivelyRunning({ status: 'queued' })).toBe(false);
    expect(isGoalActivelyRunning({ status: 'queued', workerId: null, leaseExpiresAt: null })).toBe(false);
  });

  it('is false for QUEUED with an expired lease', () => {
    expect(isGoalActivelyRunning({
      status: 'queued',
      workerId: 'w1',
      leaseExpiresAt: String(now - 60_000),
    })).toBe(false);
  });

  it('is false for terminal states', () => {
    for (const status of ['completed', 'failed', 'stopped', 'cancelled', 'timed_out']) {
      expect(isGoalActivelyRunning({ status })).toBe(false);
    }
  });

  it('is false for paused / waiting_for_approval / empty', () => {
    expect(isGoalActivelyRunning({ status: 'paused' })).toBe(false);
    expect(isGoalActivelyRunning({ status: 'waiting_for_approval' })).toBe(false);
    expect(isGoalActivelyRunning({})).toBe(false);
    expect(isGoalActivelyRunning(null as any)).toBe(false);
  });
});
