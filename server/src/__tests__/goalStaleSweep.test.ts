import { goalStore } from '../services/goalStore.js';
import { db } from '../db/index.js';
import { goals, goalEvents } from '../db/schema.js';
import { eq } from 'drizzle-orm';

describe('Stale QUEUED goal sweep (provably abandoned goals)', () => {
  const staleGoalId = 'sweep-stale-' + Date.now();
  const freshGoalId = 'sweep-fresh-' + Date.now();
  const leasedGoalId = 'sweep-leased-' + Date.now();
  const eventGoalId = 'sweep-events-' + Date.now();

  beforeAll(() => {
    db.delete(goalEvents).where(eq(goalEvents.goalId, staleGoalId)).run();
    db.delete(goalEvents).where(eq(goalEvents.goalId, freshGoalId)).run();
    db.delete(goalEvents).where(eq(goalEvents.goalId, leasedGoalId)).run();
    db.delete(goalEvents).where(eq(goalEvents.goalId, eventGoalId)).run();
    db.delete(goals).where(eq(goals.id, staleGoalId)).run();
    db.delete(goals).where(eq(goals.id, freshGoalId)).run();
    db.delete(goals).where(eq(goals.id, leasedGoalId)).run();
    db.delete(goals).where(eq(goals.id, eventGoalId)).run();
  });

  it('marks a stale queued goal (no lease, no events) as failed', async () => {
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    goalStore.create({
      id: staleGoalId, originalGoal: 'stale', status: 'queued',
      retryCount: 0, providerFallbackCount: 0, history: [],
      createdAt: old, updatedAt: old,
    });
    const swept = goalStore.sweepStaleQueuedGoals();
    expect(swept).toBeGreaterThanOrEqual(1);
    const goal = goalStore.get(staleGoalId);
    expect(goal?.status).toBe('failed');
    const events = db.select().from(goalEvents).where(eq(goalEvents.goalId, staleGoalId)).all();
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].state).toBe('failed');
  });

  it('does NOT sweep a fresh queued goal (recent updatedAt)', () => {
    const now = new Date().toISOString();
    goalStore.create({
      id: freshGoalId, originalGoal: 'fresh', status: 'queued',
      retryCount: 0, providerFallbackCount: 0, history: [],
      createdAt: now, updatedAt: now,
    });
    goalStore.sweepStaleQueuedGoals();
    expect(goalStore.get(freshGoalId)?.status).toBe('queued');
  });

  it('does NOT sweep a queued goal with an active worker lease', () => {
    const now = new Date().toISOString();
    goalStore.create({
      id: leasedGoalId, originalGoal: 'leased', status: 'queued',
      retryCount: 0, providerFallbackCount: 0, history: [],
      createdAt: now, updatedAt: now,
    });
    // Simulate a live loop holding a lease on an OLD queued row.
    db.update(goals).set({
      workerId: 'test-worker',
      leaseExpiresAt: String(Date.now() + 60_000),
      updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    }).where(eq(goals.id, leasedGoalId)).run();
    goalStore.sweepStaleQueuedGoals();
    expect(goalStore.get(leasedGoalId)?.status).toBe('queued');
  });

  it('does NOT sweep a stale queued goal that already produced events', () => {
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    goalStore.create({
      id: eventGoalId, originalGoal: 'events', status: 'queued',
      retryCount: 0, providerFallbackCount: 0, history: [],
      createdAt: old, updatedAt: old,
    });
    db.insert(goalEvents).values({
      id: `${eventGoalId}-e1`, goalId: eventGoalId, sequence: 1,
      timestamp: old, state: 'planning', step: 1, message: 'm',
      provider: 'test', model: 'test',
    }).run();
    goalStore.sweepStaleQueuedGoals();
    expect(goalStore.get(eventGoalId)?.status).toBe('queued');
  });
});
