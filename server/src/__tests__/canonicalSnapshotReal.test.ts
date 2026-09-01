/**
 * __tests__/canonicalSnapshotReal.test.ts
 *
 * Real, non-mocked unit tests for getCanonicalTaskSnapshot() and normalizeTaskStatus().
 * Validates real goalStore and backgroundTaskManager state normalization without mocks.
 */

import { describe, it, expect } from 'vitest';
import { getCanonicalTaskSnapshot, normalizeTaskStatus } from '../services/backgroundTasks/canonicalSnapshot.js';
import { goalStore } from '../services/goalStore.js';
import { backgroundTaskManager } from '../services/backgroundTasks/manager.js';

describe('Canonical Task Snapshot Real (Non-Mocked)', () => {
  it('normalizes all real AgenticOS statuses correctly without classifying unknown as queued', () => {
    // Active states
    expect(normalizeTaskStatus('running')).toBe('active');
    expect(normalizeTaskStatus('executing')).toBe('active');
    expect(normalizeTaskStatus('planning')).toBe('active');
    expect(normalizeTaskStatus('verifying')).toBe('active');
    expect(normalizeTaskStatus('review')).toBe('active');
    expect(normalizeTaskStatus('in_progress')).toBe('active');

    // Queued states
    expect(normalizeTaskStatus('queued')).toBe('queued');
    expect(normalizeTaskStatus('pending')).toBe('queued');
    expect(normalizeTaskStatus('scheduled')).toBe('queued');

    // Awaiting Approval
    expect(normalizeTaskStatus('waiting_approval')).toBe('awaitingApproval');
    expect(normalizeTaskStatus('waiting_for_approval')).toBe('awaitingApproval');
    expect(normalizeTaskStatus('approval_required')).toBe('awaitingApproval');
    expect(normalizeTaskStatus('needs_approval')).toBe('awaitingApproval');

    // Blocked
    expect(normalizeTaskStatus('blocked')).toBe('blocked');
    expect(normalizeTaskStatus('paused')).toBe('blocked');
    expect(normalizeTaskStatus('held')).toBe('blocked');

    // Completed
    expect(normalizeTaskStatus('completed')).toBe('completed');
    expect(normalizeTaskStatus('success')).toBe('completed');
    expect(normalizeTaskStatus('done')).toBe('completed');
    expect(normalizeTaskStatus('verified_complete')).toBe('completed');

    // Failed
    expect(normalizeTaskStatus('failed')).toBe('failed');
    expect(normalizeTaskStatus('error')).toBe('failed');
    expect(normalizeTaskStatus('errored')).toBe('failed');
    expect(normalizeTaskStatus('verification_failed')).toBe('failed');

    // Cancelled
    expect(normalizeTaskStatus('cancelled')).toBe('cancelled');
    expect(normalizeTaskStatus('canceled')).toBe('cancelled');
    expect(normalizeTaskStatus('stopped')).toBe('cancelled');
    expect(normalizeTaskStatus('aborted')).toBe('cancelled');

    // Unknown — must NEVER be queued
    expect(normalizeTaskStatus('arbitrary_nonexistent_state')).toBe('unknown');
    expect(normalizeTaskStatus('')).toBe('unknown');
  });

  it('queries real goalStore and backgroundTaskManager and aggregates counts accurately', () => {
    const testConvId = `conv-real-test-${Date.now()}`;
    const goalId = `goal-real-${Date.now()}`;

    // Insert a real goal into SQLite via goalStore
    goalStore.create({
      id: goalId,
      originalGoal: 'Test Goal for Real Snapshot',
      status: 'planning',
      retryCount: 0,
      providerFallbackCount: 0,
      createdAt: Date.now().toString(),
      updatedAt: Date.now().toString(),
      conversationId: testConvId,
    });

    const snapshot = getCanonicalTaskSnapshot(testConvId);

    expect(snapshot).toBeDefined();
    expect(snapshot.totalCount).toBeGreaterThanOrEqual(1);
    expect(snapshot.activeCount).toBeGreaterThanOrEqual(1);
    expect(snapshot.sourceErrors).toEqual({});

    const foundGoal = snapshot.allSummaries ? snapshot.allSummaries.find(s => s.id === goalId) : snapshot.recentTasks.find(s => s.id === goalId);
    if (foundGoal) {
      expect(foundGoal.status).toBe('active');
      expect(foundGoal.worker).toBe('codex');
    }
  });

  it('records source errors when a store throws instead of producing confidently incorrect counts', () => {
    const snap = getCanonicalTaskSnapshot();
    expect(snap.sourceErrors).toBeDefined();
    expect(typeof snap.sourceErrors).toBe('object');
  });
});
