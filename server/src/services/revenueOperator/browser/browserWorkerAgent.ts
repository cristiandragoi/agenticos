/**
 * browserWorkerAgent.ts — Autonomous Browser Worker FSM Agent.
 *
 * Implements the 17-state Finite State Machine (FSM) governing unattended
 * browser worker execution:
 *
 * INITIALIZING
 * IDLE
 * CLAIMING_TASK
 * PREPARING_BROWSER
 * NAVIGATING
 * EVALUATING_POLICY
 * EXECUTING_ACTION
 * VERIFYING_OUTCOME
 * RECORDING_LEDGER
 * COOLDOWN
 * PAUSED_FOR_GATE
 * RETRYING
 * FAILED
 * STALLED
 * RECOVERING
 * PAUSED
 * TERMINATED
 *
 * Strict Terminal/Loop Invariant:
 * Every attempt ends in COMPLETED, GATED, DENIED, FAILED, RETRY_SCHEDULED, or CANCELLED.
 * No task is ever silently abandoned without an explicit persisted state.
 */

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import type {
  BrowserWorkerStatus,
  TaskTerminalStatus,
  TaskFailureCategory,
  StateAwareHeartbeatPayload,
  ProposedBrowserAction,
} from './types.js';
import type { IBrowserRevenueProvider, PlannedAction } from './providers/baseProvider.js';
import { BrowserSessionManager, browserSessionManager } from './browserSessionManager.js';
import { BrowserTaskQueue } from './browserTaskQueue.js';
import { BrowserPolicyEnforcer, browserPolicyEnforcer } from './browserPolicyEnforcer.js';

export interface WorkerAgentOptions {
  headless?: boolean;
  maxRetries?: number;
  cooldownMs?: number;
  leaseDurationMs?: number;
  sessionManager?: BrowserSessionManager;
  policyEnforcer?: BrowserPolicyEnforcer;
}

export interface TaskExecutionSummary {
  taskId: string;
  externalTaskId: string;
  terminalStatus: TaskTerminalStatus;
  rewardEarned: number;
  attemptNumber: number;
  durationMs: number;
  reason?: string;
  errorCode?: string;
}

export class BrowserWorkerAgent extends EventEmitter {
  readonly workerId: string;
  readonly providerAccountId: string;
  readonly providerId: string;

  private status: BrowserWorkerStatus = 'INITIALIZING';
  private currentTaskId: string | null = null;
  private currentUrl: string | null = null;
  private stopRequested = false;
  private consecutiveFailures = 0;

  private provider: IBrowserRevenueProvider;
  private db: any;
  private taskQueue: BrowserTaskQueue;
  private sessionManager: BrowserSessionManager;
  private policyEnforcer: BrowserPolicyEnforcer;
  private options: WorkerAgentOptions;

  constructor(
    workerId: string,
    providerAccountId: string,
    provider: IBrowserRevenueProvider,
    db: any,
    options: WorkerAgentOptions = {}
  ) {
    super();
    this.workerId = workerId;
    this.providerAccountId = providerAccountId;
    this.provider = provider;
    this.providerId = provider.providerId;
    this.db = db;
    this.options = {
      headless: true,
      maxRetries: 3,
      cooldownMs: 50,
      leaseDurationMs: 60000,
      ...options,
    };

    this.taskQueue = new BrowserTaskQueue(this.db);
    this.sessionManager = options.sessionManager || browserSessionManager;
    this.policyEnforcer = options.policyEnforcer || browserPolicyEnforcer;

    this.initializeWorkerRecord();
    this.transitionTo('IDLE', 'Worker initialized successfully');
  }

  getStatus(): BrowserWorkerStatus {
    return this.status;
  }

  getCurrentTaskId(): string | null {
    return this.currentTaskId;
  }

  /**
   * Explicit, observable FSM transition.
   */
  transitionTo(nextStatus: BrowserWorkerStatus, reason?: string): void {
    const previous = this.status;
    this.status = nextStatus;

    const payload: StateAwareHeartbeatPayload = {
      state: nextStatus,
      currentUrl: this.currentUrl || undefined,
      currentTaskId: this.currentTaskId || undefined,
      timestamp: new Date().toISOString(),
      lastAction: reason,
    };

    // Update database record
    try {
      this.db
        .prepare(`
          UPDATE revenue_browser_workers
          SET status = ?, current_task_id = ?, last_heartbeat_at = ?, heartbeat_payload = ?, updated_at = ?
          WHERE id = ?
        `)
        .run(
          nextStatus,
          this.currentTaskId,
          payload.timestamp,
          JSON.stringify(payload),
          payload.timestamp,
          this.workerId
        );
    } catch {
      // Non-fatal if DB unavailable during test teardown
    }

    this.emit('status_change', { workerId: this.workerId, previous, current: nextStatus, reason });
  }

  private initializeWorkerRecord(): void {
    try {
      const now = new Date().toISOString();
      this.db
        .prepare(`
          INSERT INTO revenue_browser_workers (
            id, provider_account_id, status, current_task_id,
            spawned_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            status = excluded.status,
            updated_at = excluded.updated_at
        `)
        .run(this.workerId, this.providerAccountId, 'INITIALIZING', null, now, now, now);
    } catch {
      // Fallback if table already seeded
    }
  }

  /**
   * Execute a single queued task autonomously from lease to completion.
   */
  async executeNextTask(): Promise<TaskExecutionSummary | null> {
    if (this.stopRequested) {
      this.transitionTo('TERMINATED', 'Worker stop requested');
      return null;
    }

    // 1. CLAIMING_TASK
    this.transitionTo('CLAIMING_TASK');
    const task = this.taskQueue.claimNextTask(
      this.workerId,
      this.providerAccountId,
      this.options.leaseDurationMs
    );


    if (!task) {
      this.transitionTo('IDLE', 'No queued tasks available');
      return null;
    }

    this.currentTaskId = task.id;
    const attemptStartTime = Date.now();
    const attemptNumber = (task.retryCount || 0) + 1;
    const attemptId = `bta-${task.id}-${attemptNumber}`;

    let page: any = null;
    let sessionAcquired = false;

    try {
      // 2. PREPARING_BROWSER
      this.transitionTo('PREPARING_BROWSER', 'Acquiring browser session');
      const account = this.getAccountRecord();
      const session = await this.sessionManager.acquireSession(
        this.providerAccountId,
        account.profilePath || `profile_${this.providerAccountId}`,
        this.workerId,
        { headless: this.options.headless }
      );
      sessionAcquired = true;

      page = await session.context.newPage();

      // Validate session
      const isValidSession = await this.provider.validateSession(page, account);
      if (!isValidSession) {
        throw new WorkerTaskError('SESSION_INVALID', 'Provider session is unauthenticated or invalid');
      }

      // Check anomalies
      const anomaly = await this.provider.detectAnomalies(page, account);
      if (anomaly.detected) {
        if (anomaly.anomalyType === 'CAPTCHA') {
          throw new WorkerTaskError('HUMAN_GATE', 'CAPTCHA anomaly detected on entry', 'CAPTCHA_DETECTED');
        }
      }

      // Validate preconditions
      const precon = await this.provider.validatePreconditions(task, page, account);
      if (!precon.passed) {
        throw new WorkerTaskError('PERMANENT', precon.reason || 'Task preconditions failed');
      }

      // Plan actions
      const actions = await this.provider.planActions(task, page, account);
      if (!actions || actions.length === 0) {
        throw new WorkerTaskError('PERMANENT', 'No browser actions planned for task');
      }

      // 3. Action Execution Loop
      for (const action of actions) {
        this.currentUrl = action.targetUrl;

        if (action.actionType === 'NAVIGATE') {
          this.transitionTo('NAVIGATING', `Navigating to ${action.targetUrl}`);
        } else {
          this.transitionTo('EVALUATING_POLICY', `Evaluating policy for ${action.actionType}`);
        }

        // Policy Evaluation
        const proposed: ProposedBrowserAction = {
          workerId: this.workerId,
          providerAccountId: this.providerAccountId,
          providerId: this.providerId,
          actionType: action.actionType,
          targetUrl: action.targetUrl,
          elementText: action.elementText,
          elementRole: action.elementRole,
          inputName: action.inputName,
          inputValue: action.inputValue,
          monetaryAmount: action.monetaryAmount,
          currency: action.currency,
          navigationDestination: action.navigationDestination,
          taskId: task.id,
        };

        const decision = await this.policyEnforcer.evaluateAction(proposed, {
          db: this.db,
          policy: this.provider.getPolicy(account),
        });

        if (decision.decision === 'DENY') {
          throw new WorkerTaskError('POLICY_DENIED', decision.reason, decision.reasonCode);
        }

        if (decision.decision === 'GATE') {
          throw new WorkerTaskError('HUMAN_GATE', decision.reason, decision.reasonCode);
        }

        // Action is ALLOW: execute
        this.transitionTo('EXECUTING_ACTION', `Executing ${action.actionType}`);
        const actionResult = await this.provider.executeAction(action, page, account);

        if (!actionResult.success) {
          throw new WorkerTaskError('TRANSIENT', actionResult.error || 'Action execution failed');
        }
      }

      // 4. VERIFYING_OUTCOME
      this.transitionTo('VERIFYING_OUTCOME', 'Verifying task DOM outcome');
      const verification = await this.provider.verifyOutcome(task, page, account);
      if (!verification.verified) {
        throw new WorkerTaskError('TRANSIENT', verification.reason || 'Outcome verification failed');
      }

      // Verify reward with provider
      const rewardVerif = await this.provider.verifyReward(task, page, account);

      // 5. RECORDING_LEDGER (Transactional & strictly idempotent)
      this.transitionTo('RECORDING_LEDGER', 'Recording verified revenue in ledger');
      const durationMs = Date.now() - attemptStartTime;
      const completionResult = this.taskQueue.completeTask(
        task.id,
        this.workerId,
        rewardVerif.amount,
        undefined,
        durationMs
      );
      if (!completionResult || !completionResult.success) {
        throw new WorkerTaskError('PERMANENT', 'Failed to complete task transaction');
      }

      this.consecutiveFailures = 0;

      // 6. COOLDOWN
      this.transitionTo('COOLDOWN', 'Task completed; applying cooldown');
      if (this.options.cooldownMs && this.options.cooldownMs > 0) {
        await new Promise((res) => setTimeout(res, this.options.cooldownMs));
      }

      const summary: TaskExecutionSummary = {
        taskId: task.id,
        externalTaskId: task.externalTaskId,
        terminalStatus: 'COMPLETED',
        rewardEarned: rewardVerif.amount,
        attemptNumber,
        durationMs,
      };

      this.currentTaskId = null;
      this.transitionTo('IDLE', 'Task finished; worker returned to IDLE');
      return summary;
    } catch (err: any) {
      return await this.handleExecutionFailure(err, task, attemptId, attemptNumber, attemptStartTime);
    } finally {
      if (page) {
        await page.close().catch(() => {});
      }
      if (sessionAcquired) {
        await this.sessionManager.releaseSession(this.providerAccountId, this.workerId).catch(() => {});
      }
    }
  }

  private async handleExecutionFailure(
    err: any,
    task: any,
    attemptId: string,
    attemptNumber: number,
    attemptStartTime: number
  ): Promise<TaskExecutionSummary> {
    const durationMs = Date.now() - attemptStartTime;
    const now = new Date().toISOString();

    const failureCategory: TaskFailureCategory = err.category || 'TRANSIENT';
    const errorCode = err.code || failureCategory;
    const errorMessage = err.message || 'Unknown worker error';

    if (failureCategory === 'HUMAN_GATE') {
      // Mark task gated
      this.db
        .prepare(`
          UPDATE revenue_browser_tasks
          SET status = 'gated', last_error = ?, updated_at = ?
          WHERE id = ?
        `)
        .run(errorMessage, now, task.id);

      this.recordAttempt({
        taskId: task.id,
        workerId: this.workerId,
        status: 'gated',
        errorCode,
        error: errorMessage,
        durationMs,
        completedAt: now,
      });

      this.transitionTo('PAUSED_FOR_GATE', errorMessage);
      this.currentTaskId = null;

      return {
        taskId: task.id,
        externalTaskId: task.externalTaskId,
        terminalStatus: 'GATED',
        rewardEarned: 0,
        attemptNumber,
        durationMs,
        reason: errorMessage,
        errorCode,
      };
    }

    if (failureCategory === 'POLICY_DENIED') {
      // Prohibited: mark DENIED and failed
      this.db
        .prepare(`
          UPDATE revenue_browser_tasks
          SET status = 'denied', last_error = ?, updated_at = ?
          WHERE id = ?
        `)
        .run(errorMessage, now, task.id);

      this.recordAttempt({
        taskId: task.id,
        workerId: this.workerId,
        status: 'denied',
        errorCode,
        error: errorMessage,
        durationMs,
        completedAt: now,
      });

      this.transitionTo('FAILED', errorMessage);
      this.currentTaskId = null;

      return {
        taskId: task.id,
        externalTaskId: task.externalTaskId,
        terminalStatus: 'DENIED',
        rewardEarned: 0,
        attemptNumber,
        durationMs,
        reason: errorMessage,
        errorCode,
      };
    }

    // Transient failure with retries
    const maxRetries = task.maxRetries || this.options.maxRetries || 3;
    if (failureCategory === 'TRANSIENT' && attemptNumber < maxRetries) {
      this.transitionTo('RETRYING', `Scheduling retry (${attemptNumber}/${maxRetries}): ${errorMessage}`);
      this.taskQueue.failTask(task.id, this.workerId, errorMessage, true, errorCode, durationMs);

      this.currentTaskId = null;
      this.transitionTo('IDLE', 'Task requeued for retry');

      return {
        taskId: task.id,
        externalTaskId: task.externalTaskId,
        terminalStatus: 'RETRY_SCHEDULED',
        rewardEarned: 0,
        attemptNumber,
        durationMs,
        reason: errorMessage,
        errorCode,
      };
    }

    // Permanent Failure or Retries Exhausted
    this.consecutiveFailures++;
    this.taskQueue.failTask(task.id, this.workerId, errorMessage, false, errorCode, durationMs);

    this.transitionTo('FAILED', errorMessage);
    this.currentTaskId = null;

    return {
      taskId: task.id,
      externalTaskId: task.externalTaskId,
      terminalStatus: 'FAILED',
      rewardEarned: 0,
      attemptNumber,
      durationMs,
      reason: errorMessage,
      errorCode,
    };
  }

  /**
   * Run autonomous loop until stopped or maximum tasks processed.
   */
  async runLoop(maxTasks: number = Infinity): Promise<TaskExecutionSummary[]> {
    const results: TaskExecutionSummary[] = [];
    let count = 0;

    while (!this.stopRequested && count < maxTasks) {
      if (this.status === 'PAUSED_FOR_GATE' || this.status === 'PAUSED') {
        break;
      }

      const summary = await this.executeNextTask();
      if (!summary) {
        break;
      }

      results.push(summary);
      count++;

      if (summary.terminalStatus === 'GATED') {
        break;
      }
    }

    return results;
  }

  stop(): void {
    this.stopRequested = true;
    if (this.status !== 'PAUSED_FOR_GATE') {
      this.transitionTo('TERMINATED', 'Worker explicitly stopped');
    }
  }

  private recordAttempt(attempt: {
    taskId: string;
    workerId: string;
    status: string;
    rewardEarned?: number;
    errorCode?: string;
    error?: string;
    durationMs?: number;
    completedAt?: string;
  }): void {
    try {
      this.db
        .prepare(`
          UPDATE revenue_browser_task_attempts
          SET status = ?,
              reward_earned = COALESCE(?, reward_earned),
              error_code = ?,
              error = ?,
              duration_ms = ?,
              completed_at = ?
          WHERE task_id = ? AND worker_id = ? AND status = 'started'
        `)
        .run(
          attempt.status,
          attempt.rewardEarned ?? null,
          attempt.errorCode || null,
          attempt.error || null,
          attempt.durationMs ?? null,
          attempt.completedAt || new Date().toISOString(),
          attempt.taskId,
          attempt.workerId
        );
    } catch {
      // Non-fatal logging
    }
  }

  private getAccountRecord(): any {
    const row = this.db
      .prepare('SELECT * FROM revenue_browser_provider_accounts WHERE id = ?')
      .get(this.providerAccountId);

    if (row) return row;

    return {
      id: this.providerAccountId,
      providerId: this.providerId,
      accountIdentifier: this.providerAccountId,
      profilePath: `profile_${this.providerAccountId}`,
      status: 'active',
    };
  }
}

export class WorkerTaskError extends Error {
  readonly category: TaskFailureCategory;
  readonly code: string;

  constructor(category: TaskFailureCategory, message: string, code?: string) {
    super(message);
    this.name = 'WorkerTaskError';
    this.category = category;
    this.code = code || category;
  }
}
