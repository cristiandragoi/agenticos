import { db } from '../db/index.js';
import { goals, goalEvents, goalSteps, goalCheckpoints } from '../db/schema.js';
import { eq, and, sql, desc } from 'drizzle-orm';
import type { GoalState, GoalEvent, GoalRecord } from '../types.js';
import { EventEmitter } from 'events';

/**
 * Live AbortControllers for running CodeX goal loops, keyed by goal id.
 * Lives here (not in a router) so both the chat routes (pause/stop) and
 * codexService.abortGoal can abort an in-flight model request immediately.
 */
export const goalControllers = new Map<string, AbortController>();

class GoalStore extends EventEmitter {
  create(goal: GoalRecord): GoalRecord {
    db.insert(goals).values({
      id: goal.id,
      originalGoal: goal.originalGoal,
      status: goal.status,
      retryCount: goal.retryCount,
      providerFallbackCount: goal.providerFallbackCount,
      executionOptions: goal.executionOptions ? JSON.stringify(goal.executionOptions) : null,
      createdAt: goal.createdAt,
      updatedAt: goal.updatedAt,
      workspacePath: goal.workspacePath,
      conversationId: goal.conversationId,
      workspaceId: goal.workspaceId,
    }).run();
    this.emit('goal:created', goal);
    return goal;
  }

  update(id: string, patch: Partial<GoalRecord>): GoalRecord | undefined {
    const updatePayload: any = {
      ...patch,
      updatedAt: Date.now().toString()
    };
    
    if (patch.executionOptions !== undefined) {
      updatePayload.executionOptions = patch.executionOptions ? JSON.stringify(patch.executionOptions) : null;
    }

    db.update(goals).set(updatePayload).where(eq(goals.id, id)).run();

    const updated = this.get(id);
    if (updated) {
      this.emit('goal:updated', updated);
    }
    return updated;
  }

  get(id: string): GoalRecord | undefined {
    const row = db.select().from(goals).where(eq(goals.id, id)).get();
    if (!row) return undefined;

    const events = db.select().from(goalEvents).where(eq(goalEvents.goalId, id)).orderBy(goalEvents.sequence).all();

    return {
      id: row.id,
      originalGoal: row.originalGoal,
      status: row.status as GoalState,
      retryCount: row.retryCount,
      providerFallbackCount: row.providerFallbackCount,
      executionOptions: row.executionOptions ? JSON.parse(row.executionOptions) : undefined,
      checkpointId: row.activeCheckpointId || undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      workspacePath: row.workspacePath || undefined,
      conversationId: row.conversationId || undefined,
      workspaceId: row.workspaceId || undefined,
      history: events.map(e => ({
        ...e,
        payload: typeof e.payload === 'string' ? (() => { try { return JSON.parse(e.payload); } catch { return e.payload; } })() : e.payload
      })) as unknown as GoalEvent[],
      runSummary: typeof row.runSummary === 'string' ? (() => { try { return JSON.parse(row.runSummary); } catch { return row.runSummary; } })() : (row.runSummary as any)
    };
  }

  getEventsAfter(id: string, sequence: number): GoalEvent[] {
    return db.select()
      .from(goalEvents)
      .where(and(eq(goalEvents.goalId, id), sql`${goalEvents.sequence} > ${sequence}`))
      .orderBy(goalEvents.sequence)
      .all() as unknown as GoalEvent[];
  }

  createEventWriter(opts: { goalId: string; teamId?: string; agentId?: string }) {
    return {
      push: (payloadOpts: Omit<GoalEvent, 'goalId' | 'sequence' | 'timestamp' | 'step'>) => {
        if (payloadOpts.payload !== undefined) {
          try {
            JSON.stringify(payloadOpts.payload);
          } catch (e) {
            throw new Error("Payload is not JSON serializable");
          }
        }
        
        const MAX_RETRIES = 5;
        let attempt = 0;
        
        while (attempt < MAX_RETRIES) {
          try {
            db.transaction((tx) => {
              const existing = tx.select({ seq: goalEvents.sequence })
                .from(goalEvents)
                .where(eq(goalEvents.goalId, opts.goalId))
                .orderBy(desc(goalEvents.sequence))
                .limit(1)
                .get();
              
              const nextSeq = existing ? existing.seq + 1 : 1;
              
              tx.insert(goalEvents).values({
                id: `${opts.goalId}-${nextSeq}`,
                goalId: opts.goalId,
                sequence: nextSeq,
                timestamp: new Date().toISOString(),
                state: payloadOpts.state,
                step: nextSeq,
                message: payloadOpts.message,
                provider: payloadOpts.provider || 'unknown',
                model: payloadOpts.model || 'unknown',
                tool: payloadOpts.tool || null,
                checkpointId: payloadOpts.checkpointId || null,
                error: payloadOpts.error || null,
                eventType: payloadOpts.eventType || null,
                normalizedStatus: payloadOpts.normalizedStatus || null,
                lifecycleState: payloadOpts.lifecycleState || null,
                userMessage: payloadOpts.userMessage || null,
                technicalMessage: payloadOpts.technicalMessage || null,
                durationMs: payloadOpts.durationMs || null,
                filePath: payloadOpts.filePath || null,
                command: payloadOpts.command || null,
                nextAction: payloadOpts.nextAction || null,
                retryCount: payloadOpts.retryCount || null,
                requiresUserAction: payloadOpts.requiresUserAction || null,
                errorCode: payloadOpts.errorCode || null,
                errorDetails: payloadOpts.errorDetails || null,
                teamId: opts.teamId || null,
                agentId: opts.agentId || null,
                payload: payloadOpts.payload || null
              }).run();

              tx.update(goals).set({
                status: payloadOpts.state,
                updatedAt: Date.now().toString()
              }).where(eq(goals.id, opts.goalId)).run();
            });
            const updated = this.get(opts.goalId);
            if (updated) this.emit('goal:updated', updated);
            return;
          } catch (e: any) {
            if (e.code === 'SQLITE_CONSTRAINT_UNIQUE' || (e.message && e.message.includes('UNIQUE'))) {
              attempt++;
              if (attempt >= MAX_RETRIES) {
                throw new Error(`Failed to allocate sequence for event after ${MAX_RETRIES} attempts.`);
              }
              const waitTill = new Date(new Date().getTime() + 10 * attempt);
              while(waitTill > new Date()){}
            } else {
              throw e;
            }
          }
        }
      }
    };
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

  /**
   * Boot-time reconciliation: any non-terminal goal whose worker lease has
   * EXPIRED is orphaned — the backend restarted while its loop was running
   * (or the loop died). Mark it failed truthfully so the UI never shows
   * "Waiting for local model response" forever. Safe at boot because no goal
   * loop can be active in a fresh process; do NOT run this while loops run
   * (a slow model request can legitimately outlive a short lease).
   */
  sweepExpiredLeases(): number {
    const now = Date.now();
    const stale = db.select({ id: goals.id, status: goals.status })
      .from(goals)
      .where(
        and(
          sql`${goals.leaseExpiresAt} IS NOT NULL`,
          sql`CAST(${goals.leaseExpiresAt} AS INTEGER) < ${now}`,
          sql`${goals.status} NOT IN ('completed','failed','stopped','cancelled','interrupted','pause_requested')`
        )
      )
      .all();

    for (const g of stale) {
      const message = 'Backend restarted while this goal was running — the worker lease expired and no live loop exists. Marking failed; resume or retry to continue.';
      db.update(goals)
        .set({ status: 'failed', updatedAt: now.toString(), workerId: null, leaseExpiresAt: null })
        .where(eq(goals.id, g.id))
        .run();
      db.insert(goalEvents).values({
        id: `bgevt-sweep-${g.id}-${now}`,
        goalId: g.id,
        sequence: (db.select({ m: sql`COALESCE(MAX(${goalEvents.sequence}), 0)` }).from(goalEvents).where(eq(goalEvents.goalId, g.id)).get() as any)?.m + 1,
        timestamp: new Date(now).toISOString(),
        state: 'failed',
        step: 0,
        message,
        eventType: 'task_failed',
        normalizedStatus: 'failed',
        lifecycleState: 'failed',
        userMessage: message,
        technicalMessage: message,
        provider: 'agentic-os',
        model: 'goal-sweep',
      }).run();
      this.emit('goal:updated', this.get(g.id));
    }
    return stale.length;
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

  getAllGoals(limit = 100) {
    const rows = db.select().from(goals).orderBy(desc(goals.updatedAt)).limit(limit).all();
    return rows.map(r => ({
      ...r,
      executionOptions: r.executionOptions ? JSON.parse(r.executionOptions) : undefined,
      runSummary: typeof r.runSummary === 'string' ? (() => { try { return JSON.parse(r.runSummary); } catch { return r.runSummary; } })() : r.runSummary
    }));
  }

  getGoalsByStatus(statuses: string[], limit = 100) {
    if (!statuses.length) return this.getAllGoals(limit);
    const placeholders = statuses.map(() => '?').join(',');
    return db.select().from(goals).where(sql`${goals.status} IN (${sql.raw(statuses.map(s => `'${s}'`).join(','))})`).orderBy(desc(goals.updatedAt)).limit(limit).all();
  }
}

export const goalStore = new GoalStore();
