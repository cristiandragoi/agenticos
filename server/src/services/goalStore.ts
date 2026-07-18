import { db } from '../db/index.js';
import { goals, goalEvents, goalSteps, goalCheckpoints } from '../db/schema.js';
import { eq, and, sql, desc } from 'drizzle-orm';
import type { GoalState, GoalEvent, GoalRecord } from '../types.js';
import { EventEmitter } from 'events';

class GoalStore extends EventEmitter {
  create(goal: GoalRecord): GoalRecord {
    db.insert(goals).values({
      id: goal.id,
      originalGoal: goal.originalGoal,
      status: goal.status,
      retryCount: goal.retryCount,
      providerFallbackCount: goal.providerFallbackCount,
      createdAt: goal.createdAt,
      updatedAt: goal.updatedAt,
    }).run();
    this.emit('goal:created', goal);
    return goal;
  }

  update(id: string, patch: Partial<GoalRecord>): GoalRecord | undefined {
    db.update(goals).set({
      ...patch,
      updatedAt: Date.now().toString()
    }).where(eq(goals.id, id)).run();

    const updated = this.get(id);
    if (updated) {
      this.emit('goal:updated', updated);
    }
    return updated;
  }

  get(id: string): GoalRecord | undefined {
    const row = db.select().from(goals).where(eq(goals.id, id)).get();
    if (!row) return undefined;

    const events = db.select().from(goalEvents).where(eq(goalEvents.goalId, id)).orderBy(goalEvents.sequenceId).all();

    return {
      id: row.id,
      originalGoal: row.originalGoal,
      status: row.status as GoalState,
      retryCount: row.retryCount,
      providerFallbackCount: row.providerFallbackCount,
      checkpointId: row.activeCheckpointId || undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      history: events as unknown as GoalEvent[],
      runSummary: row.runSummary as any
    };
  }

  getEventsAfter(id: string, sequenceId: number): GoalEvent[] {
    return db.select()
      .from(goalEvents)
      .where(and(eq(goalEvents.goalId, id), sql`${goalEvents.sequenceId} > ${sequenceId}`))
      .orderBy(goalEvents.sequenceId)
      .all() as unknown as GoalEvent[];
  }

  pushEvent(event: GoalEvent) {
    db.insert(goalEvents).values({
      id: `${event.runId}-${event.sequenceId}`,
      goalId: event.runId,
      sequenceId: event.sequenceId,
      timestamp: event.timestamp,
      state: event.state,
      step: event.step,
      message: event.message,
      provider: event.provider,
      model: event.model,
      tool: event.tool || null,
      checkpointId: event.checkpointId || null,
      error: event.error || null,
      eventType: event.eventType || null,
      normalizedStatus: event.normalizedStatus || null,
      lifecycleState: event.lifecycleState || null,
      userMessage: event.userMessage || null,
      technicalMessage: event.technicalMessage || null,
      durationMs: event.durationMs || null,
      filePath: event.filePath || null,
      command: event.command || null,
      nextAction: event.nextAction || null,
      retryCount: event.retryCount || null,
      requiresUserAction: event.requiresUserAction || null,
      errorCode: event.errorCode || null,
      errorDetails: event.errorDetails || null
    }).onConflictDoNothing().run();

    db.update(goals).set({
      status: event.state,
      updatedAt: Date.now().toString()
    }).where(eq(goals.id, event.runId)).run();

    const updated = this.get(event.runId);
    if (updated) this.emit('goal:updated', updated);
  }

  acquireLease(goalId: string, workerId: string, durationMs: number = 30000): boolean {
    const now = Date.now();
    const expiresAt = now + durationMs;

    const result = db.update(goals)
      .set({
        workerId,
        leaseExpiresAt: expiresAt.toString(),
        updatedAt: now.toString()
      })
      .where(
        and(
          eq(goals.id, goalId),
          sql`(${goals.workerId} IS NULL OR CAST(${goals.leaseExpiresAt} AS INTEGER) < ${now} OR ${goals.workerId} = ${workerId})`
        )
      ).run();

    return result.changes > 0;
  }

  releaseLease(goalId: string, workerId: string) {
    db.update(goals)
      .set({ workerId: null, leaseExpiresAt: null, updatedAt: Date.now().toString() })
      .where(and(eq(goals.id, goalId), eq(goals.workerId, workerId)))
      .run();
  }

  upsertStep(goalId: string, stepNumber: number, status: string, toolCall?: any, toolResult?: string, error?: string) {
    db.insert(goalSteps).values({
      id: `${goalId}-step-${stepNumber}`,
      goalId,
      stepNumber,
      status,
      toolCall,
      toolResult,
      error,
      startedAt: Date.now().toString(),
    }).onConflictDoUpdate({
      target: [goalSteps.id],
      set: {
        status,
        toolResult,
        error,
        completedAt: ['completed', 'failed', 'interrupted', 'interrupted_requires_review', 'paused'].includes(status) ? Date.now().toString() : sql`${goalSteps.completedAt}`
      }
    }).run();
  }

  getStep(goalId: string, stepNumber: number) {
    return db.select().from(goalSteps).where(and(eq(goalSteps.goalId, goalId), eq(goalSteps.stepNumber, stepNumber))).get();
  }

  createCheckpoint(data: {
    id: string;
    goalId: string;
    sequenceId: number;
    stepId?: string;
    stepIndex?: number;
    goalStatus?: string;
    executionPhase?: string;
    workspaceSnapshot?: any;
    workspaceHash?: string;
    changedFiles?: string[];
  }) {
    db.insert(goalCheckpoints).values({
      id: data.id,
      goalId: data.goalId,
      sequenceId: data.sequenceId,
      stepId: data.stepId,
      stepIndex: data.stepIndex,
      goalStatus: data.goalStatus,
      executionPhase: data.executionPhase,
      workspaceSnapshot: data.workspaceSnapshot,
      workspaceHash: data.workspaceHash,
      changedFiles: data.changedFiles,
      createdAt: Date.now().toString(),
    }).run();

    db.update(goals).set({ activeCheckpointId: data.id }).where(eq(goals.id, data.goalId)).run();
    this.emit('checkpoint:created', data);
  }

  getLatestCheckpoint(goalId: string) {
    return db.select()
      .from(goalCheckpoints)
      .where(eq(goalCheckpoints.goalId, goalId))
      .orderBy(desc(goalCheckpoints.sequenceId))
      .get();
  }

  getUnfinishedGoals() {
    return db.select().from(goals).where(sql`${goals.status} IN ('queued', 'planning', 'executing', 'reasoning', 'retrying')`).all();
  }
}

export const goalStore = new GoalStore();
