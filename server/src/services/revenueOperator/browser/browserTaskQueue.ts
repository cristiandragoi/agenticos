/**
 * browserTaskQueue.ts — Transactional, duplicate-safe task leasing and idempotent revenue attribution.
 *
 * Requirements:
 * - Worker assignment remains nullable until a task is leased.
 * - Task leasing is strictly transactional (exclusive SQLite transaction) preventing duplicate claims.
 * - Idempotent task creation using providerId + externalTaskId.
 * - Idempotent task completion preventing duplicate revenue attribution in the commercial ledger.
 */

import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { rawDb } from '../../../db/index.js';
import { logger } from '../../../utils/logger.js';

export interface CreateTaskInput {
  providerId: string;
  externalTaskId: string;
  taskType: string;
  targetUrl: string;
  expectedReward?: number;
  currency?: string;
  priority?: number;
  actionPayload?: Record<string, unknown>;
  providerAccountId?: string | null;
}

export interface BrowserTaskRecord {
  id: string;
  providerId: string;
  providerAccountId: string | null;
  externalTaskId: string;
  taskType: string;
  targetUrl: string;
  actionPayload: any;
  status: 'queued' | 'leased' | 'completed' | 'failed' | 'gated' | 'cancelled';
  priority: number;
  expectedReward: number;
  actualReward: number;
  currency: string;
  claimedByWorkerId: string | null;
  leaseExpiresAt: string | null;
  retryCount: number;
  maxRetries: number;
  completedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Ensures all Phase 1 Browser Revenue tables and indexes exist in the target database.
 */
export function ensureBrowserTables(db: Database.Database = rawDb): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS revenue_browser_provider_accounts (
      id TEXT PRIMARY KEY NOT NULL,
      provider_id TEXT NOT NULL,
      account_identifier TEXT NOT NULL,
      profile_path TEXT NOT NULL,
      status TEXT DEFAULT 'active' NOT NULL,
      circuit_breaker_state TEXT,
      hourly_action_limit INTEGER DEFAULT 120 NOT NULL,
      daily_action_limit INTEGER DEFAULT 1000 NOT NULL,
      hourly_action_count INTEGER DEFAULT 0 NOT NULL,
      daily_action_count INTEGER DEFAULT 0 NOT NULL,
      last_action_at TEXT,
      total_earnings REAL DEFAULT 0 NOT NULL,
      currency TEXT DEFAULT 'EUR' NOT NULL,
      metadata TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_rev_bp_accounts_provider ON revenue_browser_provider_accounts (provider_id);
    CREATE INDEX IF NOT EXISTS idx_rev_bp_accounts_status ON revenue_browser_provider_accounts (status);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_rev_bp_accounts_provider_acc ON revenue_browser_provider_accounts (provider_id, account_identifier);

    CREATE TABLE IF NOT EXISTS revenue_browser_workers (
      id TEXT PRIMARY KEY NOT NULL,
      provider_account_id TEXT REFERENCES revenue_browser_provider_accounts(id),
      pid INTEGER,
      status TEXT DEFAULT 'SPAWNING' NOT NULL,
      current_task_id TEXT,
      last_heartbeat_at TEXT,
      heartbeat_payload TEXT,
      consecutive_failures INTEGER DEFAULT 0 NOT NULL,
      spawned_at TEXT NOT NULL,
      terminated_at TEXT,
      exit_code INTEGER,
      exit_signal TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_rev_bw_status ON revenue_browser_workers (status);
    CREATE INDEX IF NOT EXISTS idx_rev_bw_account ON revenue_browser_workers (provider_account_id);
    CREATE INDEX IF NOT EXISTS idx_rev_bw_heartbeat ON revenue_browser_workers (last_heartbeat_at);

    CREATE TABLE IF NOT EXISTS revenue_browser_tasks (
      id TEXT PRIMARY KEY NOT NULL,
      provider_id TEXT NOT NULL,
      provider_account_id TEXT REFERENCES revenue_browser_provider_accounts(id),
      external_task_id TEXT NOT NULL,
      task_type TEXT NOT NULL,
      target_url TEXT NOT NULL,
      action_payload TEXT,
      status TEXT DEFAULT 'queued' NOT NULL,
      priority INTEGER DEFAULT 50 NOT NULL,
      expected_reward REAL DEFAULT 0 NOT NULL,
      actual_reward REAL DEFAULT 0 NOT NULL,
      currency TEXT DEFAULT 'EUR' NOT NULL,
      claimed_by_worker_id TEXT REFERENCES revenue_browser_workers(id),
      lease_expires_at TEXT,
      retry_count INTEGER DEFAULT 0 NOT NULL,
      max_retries INTEGER DEFAULT 3 NOT NULL,
      completed_at TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_rev_bt_prov_acc_ext ON revenue_browser_tasks (provider_id, provider_account_id, external_task_id);
    CREATE INDEX IF NOT EXISTS idx_rev_bt_status ON revenue_browser_tasks (status);
    CREATE INDEX IF NOT EXISTS idx_rev_bt_lease_expires ON revenue_browser_tasks (lease_expires_at);
    CREATE INDEX IF NOT EXISTS idx_rev_bt_worker ON revenue_browser_tasks (claimed_by_worker_id);

    CREATE TABLE IF NOT EXISTS revenue_browser_task_attempts (
      id TEXT PRIMARY KEY NOT NULL,
      task_id TEXT NOT NULL REFERENCES revenue_browser_tasks(id),
      worker_id TEXT NOT NULL REFERENCES revenue_browser_workers(id),
      provider_account_id TEXT REFERENCES revenue_browser_provider_accounts(id),
      attempt_number INTEGER NOT NULL,
      status TEXT NOT NULL,
      reward_expected REAL DEFAULT 0 NOT NULL,
      reward_earned REAL DEFAULT 0 NOT NULL,
      error_code TEXT,
      error TEXT,
      duration_ms INTEGER,
      started_at TEXT NOT NULL,
      completed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_rev_bta_task ON revenue_browser_task_attempts (task_id);
    CREATE INDEX IF NOT EXISTS idx_rev_bta_worker ON revenue_browser_task_attempts (worker_id);
    CREATE INDEX IF NOT EXISTS idx_rev_bta_account ON revenue_browser_task_attempts (provider_account_id);


    CREATE TABLE IF NOT EXISTS revenue_browser_traces (
      id TEXT PRIMARY KEY NOT NULL,
      task_id TEXT REFERENCES revenue_browser_tasks(id),
      worker_id TEXT NOT NULL REFERENCES revenue_browser_workers(id),
      provider_account_id TEXT REFERENCES revenue_browser_provider_accounts(id),
      action_type TEXT NOT NULL,
      url TEXT NOT NULL,
      status TEXT NOT NULL,
      policy_decision TEXT,
      screenshot_path TEXT,
      execution_duration_ms INTEGER,
      error TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_rev_btrace_worker ON revenue_browser_traces (worker_id);
    CREATE INDEX IF NOT EXISTS idx_rev_btrace_task ON revenue_browser_traces (task_id);

    -- Ensure canonical revenue ledger exists for attribution tests
    CREATE TABLE IF NOT EXISTS revenue_ledger_entries (
      id TEXT PRIMARY KEY NOT NULL,
      mission_id TEXT,
      experiment_id TEXT,
      entry_type TEXT NOT NULL,
      amount REAL DEFAULT 0 NOT NULL,
      currency TEXT DEFAULT 'EUR' NOT NULL,
      status TEXT DEFAULT 'recorded' NOT NULL,
      evidence TEXT,
      provenance TEXT,
      source TEXT,
      verified_at TEXT,
      verified_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

export class BrowserTaskQueue {
  private db: Database.Database;

  constructor(db: Database.Database = rawDb) {
    this.db = db;
    ensureBrowserTables(this.db);
  }

  /**
   * Idempotently creates a new browser task.
   * If a task with (providerId, providerAccountId, externalTaskId) already exists, returns the existing record.
   */
  createTask(input: CreateTaskInput): BrowserTaskRecord {
    const existing = this.db.prepare(`
      SELECT * FROM revenue_browser_tasks
      WHERE provider_id = ?
        AND ((provider_account_id = ?) OR (provider_account_id IS NULL AND ? IS NULL))
        AND external_task_id = ?
    `).get(
      input.providerId,
      input.providerAccountId ?? null,
      input.providerAccountId ?? null,
      input.externalTaskId
    ) as any;

    if (existing) {
      return this.mapRowToTask(existing);
    }

    const id = `btask-${randomUUID()}`;
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO revenue_browser_tasks (
        id, provider_id, provider_account_id, external_task_id, task_type,
        target_url, action_payload, status, priority, expected_reward,
        actual_reward, currency, claimed_by_worker_id, lease_expires_at,
        retry_count, max_retries, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, 'queued', ?, ?,
        0, ?, NULL, NULL,
        0, 3, ?, ?
      )
    `).run(
      id,
      input.providerId,
      input.providerAccountId ?? null,
      input.externalTaskId,
      input.taskType,
      input.targetUrl,
      input.actionPayload ? JSON.stringify(input.actionPayload) : null,
      input.priority ?? 50,
      input.expectedReward ?? 0,
      input.currency ?? 'EUR',
      now,
      now
    );

    const row = this.db.prepare('SELECT * FROM revenue_browser_tasks WHERE id = ?').get(id) as any;
    return this.mapRowToTask(row);
  }

  /**
   * Atomically leases the next eligible task for a worker.
   * Safe against concurrent claims across multiple workers/processes.
   */
  claimNextTask(
    workerId: string,
    providerAccountId?: string | null,
    leaseDurationMs = 60_000
  ): BrowserTaskRecord | null {
    const now = new Date().toISOString();
    const leaseExpiresAt = new Date(Date.now() + leaseDurationMs).toISOString();

    const claimTx = this.db.transaction(() => {
      // Find candidate: either queued or lease expired, matching provider account if specified
      let query = `
        SELECT * FROM revenue_browser_tasks
        WHERE (status = 'queued' OR (status = 'leased' AND lease_expires_at < ?))
      `;
      const params: any[] = [now];

      if (providerAccountId) {
        query += ` AND (provider_account_id = ? OR provider_account_id IS NULL)`;
        params.push(providerAccountId);
      }

      query += ` ORDER BY priority DESC, created_at ASC LIMIT 1`;

      const candidate = this.db.prepare(query).get(...params) as any;
      if (!candidate) return null;

      // Update task atomically
      const result = this.db.prepare(`
        UPDATE revenue_browser_tasks
        SET status = 'leased',
            claimed_by_worker_id = ?,
            lease_expires_at = ?,
            updated_at = ?
        WHERE id = ?
          AND (status = 'queued' OR (status = 'leased' AND lease_expires_at < ?))
      `).run(workerId, leaseExpiresAt, now, candidate.id, now);

      if (result.changes === 0) {
        // Lost race to another worker
        return null;
      }

      // Record task attempt
      const attemptNumber = (candidate.retry_count || 0) + 1;
      this.db.prepare(`
        INSERT INTO revenue_browser_task_attempts (
          id, task_id, worker_id, provider_account_id, attempt_number, status, reward_expected, reward_earned, started_at
        ) VALUES (?, ?, ?, ?, ?, 'started', ?, 0, ?)
      `).run(
        `bta-${randomUUID()}`,
        candidate.id,
        workerId,
        candidate.provider_account_id ?? null,
        attemptNumber,
        candidate.expected_reward ?? 0,
        now
      );

      // Update worker currentTaskId
      this.db.prepare(`
        UPDATE revenue_browser_workers
        SET current_task_id = ?, updated_at = ?
        WHERE id = ?
      `).run(candidate.id, now, workerId);

      return this.mapRowToTask({
        ...candidate,
        status: 'leased',
        claimed_by_worker_id: workerId,
        lease_expires_at: leaseExpiresAt,
        updated_at: now,
      });
    });

    return claimTx();
  }

  /**
   * Completes a task and attributes verified revenue idempotently.
   * Duplicate completions for the same task do NOT double-count revenue in the ledger.
   */
  completeTask(
    taskId: string,
    workerId: string,
    actualReward: number,
    proofData?: Record<string, unknown>,
    durationMs?: number
  ): { success: boolean; task: BrowserTaskRecord; revenueAttributed: boolean } {
    const now = new Date().toISOString();

    const completeTx = this.db.transaction(() => {
      const taskRow = this.db.prepare('SELECT * FROM revenue_browser_tasks WHERE id = ?').get(taskId) as any;
      if (!taskRow) throw new Error(`Task '${taskId}' not found.`);

      // Check idempotency: If already completed, return without duplicating revenue attribution
      if (taskRow.status === 'completed') {
        return { success: true, task: this.mapRowToTask(taskRow), revenueAttributed: false };
      }

      // Mark task completed
      this.db.prepare(`
        UPDATE revenue_browser_tasks
        SET status = 'completed',
            actual_reward = ?,
            completed_at = ?,
            updated_at = ?
        WHERE id = ?
      `).run(actualReward, now, now, taskId);

      // Update attempt
      this.db.prepare(`
        UPDATE revenue_browser_task_attempts
        SET status = 'completed',
            reward_earned = ?,
            duration_ms = COALESCE(?, MAX(0, CAST((strftime('%f', ?) - strftime('%f', started_at)) * 1000 AS INTEGER))),
            completed_at = ?
        WHERE task_id = ? AND worker_id = ? AND status = 'started'
      `).run(actualReward, durationMs ?? null, now, now, taskId, workerId);

      let revenueAttributed = false;

      // Idempotent revenue ledger attribution (Requirement 6)
      if (actualReward > 0) {
        // Check if ledger entry already exists for this provider, account, and external task
        const existingLedger = this.db.prepare(`
          SELECT id FROM revenue_ledger_entries
          WHERE source = 'browser_revenue_operator'
            AND json_extract(provenance, '$.providerId') = ?
            AND ((json_extract(provenance, '$.providerAccountId') = ?) OR (json_extract(provenance, '$.providerAccountId') IS NULL AND ? IS NULL))
            AND json_extract(provenance, '$.externalTaskId') = ?
        `).get(
          taskRow.provider_id,
          taskRow.provider_account_id,
          taskRow.provider_account_id,
          taskRow.external_task_id
        );

        if (!existingLedger) {
          const ledgerId = `rle-${randomUUID()}`;
          const provenance = JSON.stringify({
            taskId,
            providerId: taskRow.provider_id,
            externalTaskId: taskRow.external_task_id,
            workerId,
            providerAccountId: taskRow.provider_account_id,
            proof: proofData ?? null,
          });

          this.db.prepare(`
            INSERT INTO revenue_ledger_entries (
              id, entry_type, amount, currency, status,
              provenance, source, verified_at, verified_by, created_at, updated_at
            ) VALUES (
              ?, 'VERIFIED_REVENUE', ?, ?, 'verified',
              ?, 'browser_revenue_operator', ?, ?, ?, ?
            )
          `).run(
            ledgerId,
            actualReward,
            taskRow.currency || 'EUR',
            provenance,
            now,
            workerId,
            now,
            now
          );

          // Update provider account total earnings if assigned
          if (taskRow.provider_account_id) {
            this.db.prepare(`
              UPDATE revenue_browser_provider_accounts
              SET total_earnings = total_earnings + ?,
                  last_action_at = ?,
                  hourly_action_count = hourly_action_count + 1,
                  daily_action_count = daily_action_count + 1,
                  updated_at = ?
              WHERE id = ?
            `).run(actualReward, now, now, taskRow.provider_account_id);
          }

          revenueAttributed = true;
        }
      }

      // Reset worker current_task_id
      this.db.prepare(`
        UPDATE revenue_browser_workers
        SET current_task_id = NULL, updated_at = ?
        WHERE id = ?
      `).run(now, workerId);

      const updatedRow = this.db.prepare('SELECT * FROM revenue_browser_tasks WHERE id = ?').get(taskId) as any;
      return { success: true, task: this.mapRowToTask(updatedRow), revenueAttributed };
    });

    return completeTx();
  }

  /**
   * Recovers any expired leases back to 'queued' state.
   */
  recoverExpiredLeases(now: string = new Date().toISOString()): number {
    const info = this.db.prepare(`
      UPDATE revenue_browser_tasks
      SET status = 'queued', claimed_by_worker_id = NULL, lease_expires_at = NULL, updated_at = ?
      WHERE status = 'leased' AND lease_expires_at < ?
    `).run(now, now);
    return info.changes;
  }

  /**
   * Explicitly leases a specific task to a worker (useful for targeted assignment / testing).
   */
  leaseTask(taskId: string, workerId: string, durationMs = 60_000): boolean {
    const now = new Date().toISOString();
    const leaseExpiresAt = new Date(Date.now() + durationMs).toISOString();
    const info = this.db.prepare(`
      UPDATE revenue_browser_tasks
      SET status = 'leased', claimed_by_worker_id = ?, lease_expires_at = ?, updated_at = ?
      WHERE id = ? AND (status = 'queued' OR (status = 'leased' AND lease_expires_at < ?))
    `).run(workerId, leaseExpiresAt, now, taskId, now);
    return info.changes > 0;
  }

  /**
   * Releases or fails a task upon error.
   */
  failTask(
    taskId: string,
    workerId: string,
    error: string,
    retryable = true,
    errorCode?: string,
    durationMs?: number
  ): BrowserTaskRecord {
    const now = new Date().toISOString();

    const failTx = this.db.transaction(() => {
      const task = this.db.prepare('SELECT * FROM revenue_browser_tasks WHERE id = ?').get(taskId) as any;
      if (!task) throw new Error(`Task '${taskId}' not found.`);

      const newRetryCount = (task.retry_count || 0) + 1;
      const willRetry = retryable && newRetryCount < (task.max_retries || 3);
      const newStatus = willRetry ? 'queued' : 'failed';

      this.db.prepare(`
        UPDATE revenue_browser_tasks
        SET status = ?,
            claimed_by_worker_id = ?,
            lease_expires_at = NULL,
            retry_count = ?,
            last_error = ?,
            updated_at = ?
        WHERE id = ?
      `).run(newStatus, willRetry ? null : workerId, newRetryCount, error, now, taskId);

      this.db.prepare(`
        UPDATE revenue_browser_task_attempts
        SET status = ?,
            error_code = ?,
            error = ?,
            duration_ms = COALESCE(?, MAX(0, CAST((strftime('%f', ?) - strftime('%f', started_at)) * 1000 AS INTEGER))),
            completed_at = ?
        WHERE task_id = ? AND worker_id = ? AND status = 'started'
      `).run(newStatus, errorCode ?? null, error, durationMs ?? null, now, now, taskId, workerId);

      this.db.prepare(`
        UPDATE revenue_browser_workers
        SET current_task_id = NULL,
            consecutive_failures = consecutive_failures + 1,
            last_error = ?,
            updated_at = ?
        WHERE id = ?
      `).run(error, now, workerId);

      const updated = this.db.prepare('SELECT * FROM revenue_browser_tasks WHERE id = ?').get(taskId) as any;
      return this.mapRowToTask(updated);
    });

    return failTx();
  }


  private mapRowToTask(row: any): BrowserTaskRecord {
    return {
      id: row.id,
      providerId: row.provider_id,
      providerAccountId: row.provider_account_id ?? null,
      externalTaskId: row.external_task_id,
      taskType: row.task_type,
      targetUrl: row.target_url,
      actionPayload: typeof row.action_payload === 'string' ? JSON.parse(row.action_payload) : row.action_payload,
      status: row.status,
      priority: row.priority ?? 50,
      expectedReward: row.expected_reward ?? 0,
      actualReward: row.actual_reward ?? 0,
      currency: row.currency ?? 'EUR',
      claimedByWorkerId: row.claimed_by_worker_id ?? null,
      leaseExpiresAt: row.lease_expires_at ?? null,
      retryCount: row.retry_count ?? 0,
      maxRetries: row.max_retries ?? 3,
      completedAt: row.completed_at ?? null,
      lastError: row.last_error ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
