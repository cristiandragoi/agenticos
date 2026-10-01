/**
 * GoalLifecycle.ts — Universal Goal Run & Lifecycle Management
 *
 * Implements Section 1, 11, 12, and 18:
 * - Durable GoalRun tracking from RECEIVED to COMPLETED/FAILED
 * - Retains original user input throughout all retries and recoveries
 * - Connects incidents to active goals and conversations
 * - Timeline recording for live UI observability
 */

import { EventEmitter } from 'node:events';
import { db } from '../../db/index.js';
import { goalRuns } from './schema.js';
import { eq, desc, notInArray } from 'drizzle-orm';
import { logger } from '../../utils/logger.js';
import { acknowledgementService } from './AcknowledgementService.js';
import type {
  GoalRun,
  GoalStatus,
  GoalAttempt,
  GoalFailure,
  GoalVerification,
  GoalTimelineEvent,
  LearnedResolution,
  GoalPlan,
} from './types.js';

export class GoalLifecycleManager extends EventEmitter {
  private static instance: GoalLifecycleManager;
  private activeGoals: Map<string, GoalRun> = new Map();
  private conversationGoals: Map<string, string> = new Map(); // conversationId -> goalId

  private constructor() {
    super();
    this.setMaxListeners(100);
  }

  public static getInstance(): GoalLifecycleManager {
    if (!GoalLifecycleManager.instance) {
      GoalLifecycleManager.instance = new GoalLifecycleManager();
    }
    return GoalLifecycleManager.instance;
  }

  /**
   * Initialize a goal (alias for startGoal with flexible options).
   */
  public initializeGoal(opts: {
    rawPrompt?: string;
    userInput?: string;
    normalizedGoal?: string;
    category?: string;
    target?: string;
    clientTurnId?: number | string;
    turnId?: string;
    conversationId?: string;
    workspacePath?: string;
  }): GoalRun {
    return this.startGoal({
      conversationId: opts.conversationId || `conv-${Date.now()}`,
      turnId: opts.turnId || (opts.clientTurnId !== undefined ? String(opts.clientTurnId) : undefined),
      userInput: opts.userInput || opts.rawPrompt || 'Engineering Goal',
      normalizedGoal: opts.normalizedGoal,
      target: opts.target,
    });
  }

  /**
   * Start a new durable GoalRun from user input.
   */
  public startGoal(opts: {
    conversationId: string;
    turnId?: string;
    userInput: string;
    normalizedGoal?: string;
    target?: string;
  }): GoalRun {
    const goalId = `goal-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const now = new Date().toISOString();
    const normalizedGoal = opts.normalizedGoal || opts.userInput.trim();
    const ack = acknowledgementService.generateAcknowledgement(opts.userInput, opts.target);

    const initialTimeline: GoalTimelineEvent[] = [
      {
        timestamp: now,
        state: 'RECEIVED',
        actor: 'User',
        summary: `User commanded: "${opts.userInput}"`,
      },
      {
        timestamp: new Date().toISOString(),
        state: 'ACKNOWLEDGED',
        actor: 'Jarvis',
        summary: ack,
      },
    ];

    const run: GoalRun = {
      goalId,
      conversationId: opts.conversationId,
      turnId: opts.turnId,
      originalUserInput: opts.userInput,
      normalizedGoal,
      status: 'ACKNOWLEDGED',
      attempts: [],
      currentAttempt: 1,
      capabilitiesUsed: [],
      evidence: [],
      failures: [],
      timeline: initialTimeline,
      acknowledgementText: ack,
      createdAt: now,
      updatedAt: now,
    };

    this.activeGoals.set(goalId, run);
    this.conversationGoals.set(opts.conversationId, goalId);

    // Persist to SQLite
    this.persist(run);

    this.emit('goal:created', run);
    this.emit('goal:state', { goalId, status: 'ACKNOWLEDGED', summary: ack });

    logger.info(`[GoalLifecycle] Goal ${goalId} initialized & acknowledged: "${opts.userInput}"`);
    return run;
  }

  /**
   * Transition goal to a new lifecycle state with timeline logging.
   */
  public transitionState(
    goalId: string,
    nextStatus: GoalStatus,
    opts: {
      actor?: GoalTimelineEvent['actor'];
      summary: string;
      detail?: any;
    }
  ): GoalRun {
    const run = this.activeGoals.get(goalId) || this.loadFromDb(goalId);
    if (!run) {
      throw new Error(`[GoalLifecycle] Goal ${goalId} not found.`);
    }

    const previousStatus = run.status;
    const now = new Date().toISOString();

    if (nextStatus === 'COMPLETED') {
      const verified = run.finalVerification?.verified === true || (opts.detail?.verified === true && opts.actor === 'Argus');
      if (!verified) {
        logger.warn(`[GoalLifecycle] Rejected transition to COMPLETED for goal ${goalId}: Argus physical verification is required and unverified.`);
        throw new Error(`[GoalLifecycle] Cannot complete Goal ${goalId}: Argus physical verification has not certified this goal.`);
      }
    }

    run.status = nextStatus;
    run.updatedAt = now;

    const event: GoalTimelineEvent = {
      timestamp: now,
      state: nextStatus,
      actor: opts.actor || 'ControlPlane',
      summary: opts.summary,
      detail: opts.detail,
    };

    run.timeline.push(event);

    this.activeGoals.set(goalId, run);
    this.persist(run);

    this.emit('goal:state', { goalId, from: previousStatus, to: nextStatus, event });
    logger.info(`[GoalLifecycle] Goal ${goalId}: ${previousStatus} -> ${nextStatus} (${opts.summary})`);

    return run;
  }

  public setPlan(goalId: string, plan: GoalPlan): void {
    const run = this.activeGoals.get(goalId);
    if (!run) return;
    run.plan = plan;
    run.updatedAt = new Date().toISOString();
    this.persist(run);
  }

  public recordAttempt(goalId: string, attempt: GoalAttempt): void {
    const run = this.activeGoals.get(goalId);
    if (!run) return;
    run.attempts.push(attempt);
    run.currentAttempt = attempt.attemptNumber;
    if (!run.capabilitiesUsed.includes(attempt.surface)) {
      run.capabilitiesUsed.push(attempt.surface);
    }
    if (attempt.evidence) {
      run.evidence.push(...attempt.evidence);
    }
    run.updatedAt = new Date().toISOString();
    this.persist(run);
  }

  public recordFailure(goalId: string, failure: GoalFailure): void {
    const run = this.activeGoals.get(goalId);
    if (!run) return;
    run.failures.push(failure);
    run.updatedAt = new Date().toISOString();
    this.persist(run);
  }

  public recordVerification(goalId: string, verification: GoalVerification): void {
    const run = this.activeGoals.get(goalId);
    if (!run) return;
    run.finalVerification = verification;
    if (verification.evidence) {
      run.evidence.push(...verification.evidence);
    }
    run.updatedAt = new Date().toISOString();
    this.persist(run);
  }

  public recordLearnedResolution(goalId: string, resolution: LearnedResolution): void {
    const run = this.activeGoals.get(goalId);
    if (!run) return;
    run.learnedResolution = resolution;
    run.updatedAt = new Date().toISOString();
    this.persist(run);
  }

  public linkIncident(goalId: string, incidentId: string): void {
    const run = this.activeGoals.get(goalId);
    if (!run) return;
    run.recoveryIncidentId = incidentId;
    run.updatedAt = new Date().toISOString();
    this.persist(run);
  }

  public getActiveGoalForConversation(conversationId: string): GoalRun | null {
    const goalId = this.conversationGoals.get(conversationId);
    if (!goalId) return null;
    return this.activeGoals.get(goalId) || this.loadFromDb(goalId);
  }

  public getGoalRun(goalId: string): GoalRun | null {
    return this.activeGoals.get(goalId) || this.loadFromDb(goalId);
  }

  public listGoalRuns(limit: number = 50): GoalRun[] {
    try {
      const rows = db.select().from(goalRuns).orderBy(desc(goalRuns.createdAt)).limit(limit).all();
      return rows.map(r => ({
        goalId: r.goalId,
        conversationId: r.conversationId,
        turnId: r.turnId || undefined,
        originalUserInput: r.originalUserInput,
        normalizedGoal: r.normalizedGoal,
        status: r.status as GoalStatus,
        plan: r.plan,
        attempts: r.attempts || [],
        currentAttempt: r.currentAttempt,
        capabilitiesUsed: r.capabilitiesUsed || [],
        evidence: r.evidence || [],
        failures: r.failures || [],
        recoveryIncidentId: r.recoveryIncidentId || undefined,
        finalVerification: r.finalVerification,
        learnedResolution: r.learnedResolution,
        timeline: r.timeline || [],
        acknowledgementText: r.acknowledgementText || undefined,
        finalResponseText: r.finalResponseText || undefined,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      }));
    } catch {
      return Array.from(this.activeGoals.values());
    }
  }

  /**
   * Reconcile goals after backend restart.
   * Restores interrupted non-terminal goals to RECOVERABLE so they can be resumed,
   * without losing the user's original intent or leaving orphan locks.
   */
  public restoreAfterRestart(): { reconciledCount: number } {
    let count = 0;
    try {
      const nonTerminal = db.select().from(goalRuns)
        .where(
          notInArray(goalRuns.status, ['COMPLETED', 'FAILED_EXHAUSTED', 'CANCELLED', 'RECOVERABLE'])
        )
        .all();

      for (const row of nonTerminal) {
        const run: GoalRun = {
          goalId: row.goalId,
          conversationId: row.conversationId,
          turnId: row.turnId || undefined,
          originalUserInput: row.originalUserInput,
          normalizedGoal: row.normalizedGoal,
          status: 'RECOVERABLE',
          plan: row.plan,
          attempts: row.attempts || [],
          currentAttempt: row.currentAttempt,
          capabilitiesUsed: row.capabilitiesUsed || [],
          evidence: row.evidence || [],
          failures: row.failures || [],
          recoveryIncidentId: row.recoveryIncidentId || undefined,
          finalVerification: row.finalVerification,
          learnedResolution: row.learnedResolution,
          timeline: [
            ...(row.timeline || []),
            {
              timestamp: new Date().toISOString(),
              state: 'RECOVERABLE',
              actor: 'ControlPlane',
              summary: 'Backend restarted while goal was active. Goal restored in recoverable state.',
            },
          ],
          acknowledgementText: row.acknowledgementText || undefined,
          finalResponseText: row.finalResponseText || undefined,
          createdAt: row.createdAt,
          updatedAt: new Date().toISOString(),
        };

        this.activeGoals.set(run.goalId, run);
        if (run.conversationId) {
          this.conversationGoals.set(run.conversationId, run.goalId);
        }
        this.persist(run);
        count++;
      }
      logger.info(`[GoalLifecycle] restoreAfterRestart: reconciled ${count} active goal(s) to RECOVERABLE.`);
    } catch (err: any) {
      logger.warn(`[GoalLifecycle] restoreAfterRestart warning: ${err?.message}`);
    }
    return { reconciledCount: count };
  }

  private persist(run: GoalRun): void {
    try {
      db.insert(goalRuns)
        .values({
          goalId: run.goalId,
          conversationId: run.conversationId,
          turnId: run.turnId || null,
          originalUserInput: run.originalUserInput,
          normalizedGoal: run.normalizedGoal,
          status: run.status,
          plan: run.plan || null,
          attempts: run.attempts,
          currentAttempt: run.currentAttempt,
          capabilitiesUsed: run.capabilitiesUsed,
          evidence: run.evidence,
          failures: run.failures,
          recoveryIncidentId: run.recoveryIncidentId || null,
          finalVerification: run.finalVerification || null,
          learnedResolution: run.learnedResolution || null,
          timeline: run.timeline,
          acknowledgementText: run.acknowledgementText || null,
          finalResponseText: run.finalResponseText || null,
          createdAt: run.createdAt,
          updatedAt: run.updatedAt,
        })
        .onConflictDoUpdate({
          target: goalRuns.goalId,
          set: {
            status: run.status,
            plan: run.plan || null,
            attempts: run.attempts,
            currentAttempt: run.currentAttempt,
            capabilitiesUsed: run.capabilitiesUsed,
            evidence: run.evidence,
            failures: run.failures,
            recoveryIncidentId: run.recoveryIncidentId || null,
            finalVerification: run.finalVerification || null,
            learnedResolution: run.learnedResolution || null,
            timeline: run.timeline,
            acknowledgementText: run.acknowledgementText || null,
            finalResponseText: run.finalResponseText || null,
            updatedAt: run.updatedAt,
          },
        })
        .run();
    } catch (err: any) {
      logger.warn(`[GoalLifecycle] DB persist warning for ${run.goalId}: ${err?.message}`);
    }
  }

  private loadFromDb(goalId: string): GoalRun | null {
    try {
      const rows = db.select().from(goalRuns).where(eq(goalRuns.goalId, goalId)).all();
      if (rows.length === 0) return null;
      const r = rows[0];
      const run: GoalRun = {
        goalId: r.goalId,
        conversationId: r.conversationId,
        turnId: r.turnId || undefined,
        originalUserInput: r.originalUserInput,
        normalizedGoal: r.normalizedGoal,
        status: r.status as GoalStatus,
        plan: r.plan,
        attempts: r.attempts || [],
        currentAttempt: r.currentAttempt,
        capabilitiesUsed: r.capabilitiesUsed || [],
        evidence: r.evidence || [],
        failures: r.failures || [],
        recoveryIncidentId: r.recoveryIncidentId || undefined,
        finalVerification: r.finalVerification,
        learnedResolution: r.learnedResolution,
        timeline: r.timeline || [],
        acknowledgementText: r.acknowledgementText || undefined,
        finalResponseText: r.finalResponseText || undefined,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      };
      this.activeGoals.set(goalId, run);
      return run;
    } catch {
      return null;
    }
  }
}

export const goalLifecycleManager = GoalLifecycleManager.getInstance();
