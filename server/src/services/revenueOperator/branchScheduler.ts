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

  /**
   * Deterministic fair selection: least-recently-selected eligible branch
   * first, tie-broken by stable id. Returns the chosen experimentId or null.
   */
  selectNext(candidates: string[]): string | null {
    ensureTable();
    const eligible = candidates.filter((id) => this.isEligible(id));
    if (eligible.length === 0) return null;
    eligible.sort((a, b) => {
      const sa = this.getState(a);
      const sb = this.getState(b);
      const ta = sa.lastSelectedAt ? new Date(sa.lastSelectedAt).getTime() : 0;
      const tb = sb.lastSelectedAt ? new Date(sb.lastSelectedAt).getTime() : 0;
      if (ta !== tb) return ta - tb; // least-recently-selected first
      return a < b ? -1 : a > b ? 1 : 0; // stable id tie-break
    });
    return eligible[0];
  },
};
