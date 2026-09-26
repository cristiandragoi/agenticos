/**
 * branchScheduler.ts — Phase 2D deterministic fair branch selection.
 *
 * Persists per-branch scheduling state (last selected, next eligible time,
 * retry count) so that:
 *   - branches are not starved (least-recently-selected first),
 *   - a transient failure backs off before retry (bounded: max 3 attempts),
 *   - a permanent failure is recorded truthfully,
 *   - restart recovery continues persisted work,
 *   - only one action per experiment/idempotency key is active at a time.
 */

import { rawDb } from '../../db/index.js';

export interface BranchState {
  experimentId: string;
  lastSelectedAt: string | null;
  nextEligibleAt: string | null;
  retryCount: number;
  lastAction: string | null;
  lastStatus: string | null;
  permanentFailure: boolean;
}

const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 30_000; // 30s, 60s, 120s for attempts 1..3

function ensureTable(): void {
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS revenue_branch_state (
      experiment_id TEXT PRIMARY KEY,
      last_selected_at TEXT,
      next_eligible_at TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,
      last_action TEXT,
      last_status TEXT,
      permanent_failure INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS revenue_resource_locks (
      resource_key TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      acquired_at TEXT NOT NULL
    );
  `);
}

function rowToState(row: any): BranchState {
  return {
    experimentId: row.experiment_id,
    lastSelectedAt: row.last_selected_at ?? null,
    nextEligibleAt: row.next_eligible_at ?? null,
    retryCount: row.retry_count ?? 0,
    lastAction: row.last_action ?? null,
    lastStatus: row.last_status ?? null,
    permanentFailure: !!row.permanent_failure,
  };
}

export function backoffMs(retryCount: number): number {
  return BASE_BACKOFF_MS * Math.pow(2, Math.min(retryCount, MAX_RETRIES));
}

export const branchScheduler = {
  ensureTable,

  getState(experimentId: string): BranchState {
    ensureTable();
    const row = rawDb.prepare('SELECT * FROM revenue_branch_state WHERE experiment_id = ?').get(experimentId) as any;
    return row ? rowToState(row) : {
      experimentId, lastSelectedAt: null, nextEligibleAt: null,
      retryCount: 0, lastAction: null, lastStatus: null, permanentFailure: false,
    };
  },

  /** Record a successful selection/execution (resets retry + backoff). */
  recordSuccess(experimentId: string, action: string, status: string): void {
    ensureTable();
    const now = new Date().toISOString();
    rawDb.prepare(`
      INSERT INTO revenue_branch_state
        (experiment_id, last_selected_at, next_eligible_at, retry_count, last_action, last_status, permanent_failure)
      VALUES (?, ?, NULL, 0, ?, ?, 0)
      ON CONFLICT(experiment_id) DO UPDATE SET
        last_selected_at=excluded.last_selected_at, next_eligible_at=NULL,
        retry_count=0, last_action=excluded.last_action, last_status=excluded.last_status,
        permanent_failure=0
    `).run(experimentId, now, action, status);
  },

  /** Record a transient failure: back off before retry (bounded). */
  recordTransientFailure(experimentId: string, action: string, status: string, error: string): { retryCount: number; exhausted: boolean } {
    ensureTable();
    const existing = this.getState(experimentId);
    const retryCount = existing.retryCount + 1;
    const exhausted = retryCount >= MAX_RETRIES;
    const nextEligibleAt = exhausted ? null : new Date(Date.now() + backoffMs(retryCount)).toISOString();
    rawDb.prepare(`
      INSERT INTO revenue_branch_state
        (experiment_id, last_selected_at, next_eligible_at, retry_count, last_action, last_status, permanent_failure)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(experiment_id) DO UPDATE SET
        last_selected_at=excluded.last_selected_at, next_eligible_at=excluded.next_eligible_at,
        retry_count=excluded.retry_count, last_action=excluded.last_action, last_status=excluded.last_status,
        permanent_failure=excluded.permanent_failure
    `).run(experimentId, new Date().toISOString(), nextEligibleAt, retryCount, action, `${status}: ${error}`, exhausted ? 1 : 0);
    return { retryCount, exhausted };
  },

  /** Record a permanent failure (no further autonomous attempts). */
  recordPermanentFailure(experimentId: string, action: string, status: string, error: string): void {
    ensureTable();
    rawDb.prepare(`
      INSERT INTO revenue_branch_state
        (experiment_id, last_selected_at, next_eligible_at, retry_count, last_action, last_status, permanent_failure)
      VALUES (?, ?, NULL, ?, ?, ?, 1)
      ON CONFLICT(experiment_id) DO UPDATE SET
        last_selected_at=excluded.last_selected_at, next_eligible_at=NULL,
        retry_count=excluded.retry_count, last_action=excluded.last_action, last_status=excluded.last_status,
        permanent_failure=1
    `).run(experimentId, new Date().toISOString(), this.getState(experimentId).retryCount, action, `${status}: ${error}`);
  },

  isEligible(experimentId: string): boolean {
    const s = this.getState(experimentId);
    if (s.permanentFailure) return false;
    if (!s.nextEligibleAt) return true;
    return new Date(s.nextEligibleAt).getTime() <= Date.now();
  },

  // ── Conflict Prevention & Resource Locking ──────────────────────────────────
  /**
   * Acquire an exclusive lock on a resource (file path, DB entity, credential, deployment target).
   * Returns true if lock was acquired, false if already held by another task.
   */
  acquireLock(resourceKey: string, taskId: string): boolean {
    ensureTable();
    const existing = rawDb.prepare('SELECT task_id FROM revenue_resource_locks WHERE resource_key = ?').get(resourceKey) as any;
    if (existing) {
      return existing.task_id === taskId; // re-entrant for same task
    }
    try {
      rawDb.prepare('INSERT INTO revenue_resource_locks (resource_key, task_id, acquired_at) VALUES (?, ?, ?)')
        .run(resourceKey, taskId, new Date().toISOString());
      return true;
    } catch {
      return false;
    }
  },

  releaseLock(resourceKey: string, taskId: string): void {
    ensureTable();
    rawDb.prepare('DELETE FROM revenue_resource_locks WHERE resource_key = ? AND task_id = ?').run(resourceKey, taskId);
  },

  releaseAllLocksForTask(taskId: string): void {
    ensureTable();
    rawDb.prepare('DELETE FROM revenue_resource_locks WHERE task_id = ?').run(taskId);
  },

  isResourceLocked(resourceKey: string, currentTaskId?: string): boolean {
    ensureTable();
    const existing = rawDb.prepare('SELECT task_id FROM revenue_resource_locks WHERE resource_key = ?').get(resourceKey) as any;
    if (!existing) return false;
    return currentTaskId ? existing.task_id !== currentTaskId : true;
  },

  getActiveLocks(): Array<{ resourceKey: string; taskId: string; acquiredAt: string }> {
    ensureTable();
    const rows = rawDb.prepare('SELECT resource_key as resourceKey, task_id as taskId, acquired_at as acquiredAt FROM revenue_resource_locks').all() as any[];
    return rows;
  },

  // ── Dependency-Aware Execution ──────────────────────────────────────────────
  /**
   * Check if all dependency tasks have completed before launching dependent work.
   */
  canExecuteWithDependencies(dependencyTaskIds: string[]): boolean {
    if (!dependencyTaskIds || dependencyTaskIds.length === 0) return true;
    ensureTable();
    try {
      const placeholders = dependencyTaskIds.map(() => '?').join(',');
      const rows = rawDb.prepare(`SELECT status FROM background_tasks WHERE task_id IN (${placeholders})`).all(...dependencyTaskIds) as any[];
      if (rows.length < dependencyTaskIds.length) return false; // missing dependency record
      return rows.every(r => r.status === 'completed');
    } catch {
      return true;
    }
  },

  /**
   * Deterministic priority-aware and fair selection:
   * 1. Primary sort: project priority (1 = Free Cash, 2 = Shopify, 3 = TikTok Shop, etc.)
   * 2. Secondary sort: least-recently-selected eligible branch first (LRU within same priority)
   * 3. Tertiary sort: stable experiment ID string tie-break
   */
  selectNext(candidates: string[], priorityMap?: Record<string, number>): string | null {
    ensureTable();
    const eligible = candidates.filter((id) => this.isEligible(id));
    if (eligible.length === 0) return null;

    eligible.sort((a, b) => {
      // 1. Priority sort
      if (priorityMap) {
        const prioA = priorityMap[a] ?? 999;
        const prioB = priorityMap[b] ?? 999;
        if (prioA !== prioB) return prioA - prioB;
      }

      // 2. LRU sort
      const sa = this.getState(a);
      const sb = this.getState(b);
      const ta = sa.lastSelectedAt ? new Date(sa.lastSelectedAt).getTime() : 0;
      const tb = sb.lastSelectedAt ? new Date(sb.lastSelectedAt).getTime() : 0;
      if (ta !== tb) return ta - tb;

      // 3. Stable ID tie-break
      return a < b ? -1 : a > b ? 1 : 0;
    });

    return eligible[0];
  },
};
