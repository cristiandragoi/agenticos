/**
 * Maintenance ChangeSet persistence — Phase 4G (+ Phase 4.1 provenance,
 * Phase 4 hardening).
 *
 * Persists the MaintenanceChangeSet model to SQLite using the SAME idempotent
 * DDL pattern as backgroundTasks/store.ts (`rawDb` + CREATE TABLE IF NOT EXISTS).
 * This is the ONLY new table the maintenance supervisor introduces; it holds the
 * durable ownership/status of a repair, NOT worker results (those stay in
 * execution_results.structured_output — the existing authority).
 *
 * Phase 4.1 persists the LAST attempt's provenance handles (planResultId,
 * repairResultId, filesChanged, testResults, verification) so Jarvis can answer
 * "what did Hermes recommend?", "what did CodeX change?", and "did the fix
 * work?" from persisted evidence after a backend restart.
 *
 * Phase 4 hardening: `files_changed_json` now stores TYPED `ChangedFile[]`
 * evidence (path + changeType) instead of a bare string list, and a new
 * `reproduced_failure_json` column persists the reproduced failure evidence.
 */

import { rawDb } from '../../db/index.js';
import type { MaintenanceChangeSet, ChangeSetStatus, PersistedTestResult, PersistedVerification, ChangedFile, FileChangeType, MaintenanceTestGate } from './changeSet.js';
import { createChangeSet } from './changeSet.js';

const DDL = `
CREATE TABLE IF NOT EXISTS maintenance_change_sets (
  id TEXT PRIMARY KEY,
  originating_finding_id TEXT,
  originating_result_id TEXT,
  task_id TEXT,
  files_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'investigating',
  attempts INTEGER NOT NULL DEFAULT 0,
  reason TEXT,
  plan_result_id TEXT,
  repair_result_id TEXT,
  files_changed_json TEXT,
  test_results_json TEXT,
  verification_json TEXT,
  reproduced_failure_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mcs_status ON maintenance_change_sets(status);
`;

// Idempotent additive columns for tables created before Phase 4 hardening.
const ADD_COLUMNS = [
  `ALTER TABLE maintenance_change_sets ADD COLUMN reproduced_failure_json TEXT`,
];

let initialized = false;

export function ensureMaintenanceTables(): void {
  if (initialized) return;
  rawDb.exec(DDL);
  for (const stmt of ADD_COLUMNS) {
    try {
      rawDb.exec(stmt);
    } catch {
      // column already exists — ignore
    }
  }
  initialized = true;
}

interface ChangeSetRow {
  id: string;
  originating_finding_id: string | null;
  originating_result_id: string | null;
  task_id: string | null;
  files_json: string;
  status: ChangeSetStatus;
  attempts: number;
  reason: string | null;
  plan_result_id: string | null;
  repair_result_id: string | null;
  files_changed_json: string | null;
  test_results_json: string | null;
  verification_json: string | null;
  reproduced_failure_json?: string | null;
  created_at: string;
  updated_at: string;
}

function parseJsonArray<T>(raw: string | null): T[] | undefined {
  if (!raw) return undefined;
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as T[]) : undefined;
  } catch {
    return undefined;
  }
}

/** Parse changed-file evidence: typed `ChangedFile[]` (new) or `string[]` (legacy). */
function parseChangedFiles(raw: string | null): ChangedFile[] | undefined {
  if (!raw) return undefined;
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return undefined;
    return v.map((e): ChangedFile => {
      if (typeof e === 'string') return { path: e, changeType: 'modified' as FileChangeType };
      return { path: String(e?.path ?? ''), changeType: (['modified', 'created', 'deleted', 'renamed'].includes(e?.changeType) ? e.changeType : 'modified') as FileChangeType };
    }).filter((c) => c.path);
  } catch {
    return undefined;
  }
}

function rowToChangeSet(row: ChangeSetRow): MaintenanceChangeSet {
  let files: string[] = [];
  try {
    files = JSON.parse(row.files_json) as string[];
  } catch {
    files = [];
  }
  const cs = createChangeSet({
    id: row.id,
    originatingFindingId: row.originating_finding_id ?? undefined,
    originatingResultId: row.originating_result_id ?? undefined,
    taskId: row.task_id ?? undefined,
    files,
  });
  return {
    ...cs,
    status: row.status,
    attempts: row.attempts,
    reason: row.reason ?? undefined,
    planResultId: row.plan_result_id ?? undefined,
    repairResultId: row.repair_result_id ?? undefined,
    filesChanged: parseChangedFiles(row.files_changed_json),
    testResults: parseJsonArray<PersistedTestResult>(row.test_results_json),
    verification: row.verification_json
      ? (() => { try { return JSON.parse(row.verification_json) as PersistedVerification; } catch { return undefined; } })()
      : undefined,
    reproducedFailure: parseJsonArray<PersistedTestResult>(row.reproduced_failure_json ?? null),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function saveChangeSet(changeset: MaintenanceChangeSet): void {
  ensureMaintenanceTables();
  rawDb
    .prepare(
      `INSERT INTO maintenance_change_sets
        (id, originating_finding_id, originating_result_id, task_id, files_json, status, attempts, reason,
         plan_result_id, repair_result_id, files_changed_json, test_results_json, verification_json,
         reproduced_failure_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         originating_finding_id=excluded.originating_finding_id,
         originating_result_id=excluded.originating_result_id,
         task_id=excluded.task_id,
         files_json=excluded.files_json,
         status=excluded.status,
         attempts=excluded.attempts,
         reason=excluded.reason,
         plan_result_id=excluded.plan_result_id,
         repair_result_id=excluded.repair_result_id,
         files_changed_json=excluded.files_changed_json,
         test_results_json=excluded.test_results_json,
         verification_json=excluded.verification_json,
         reproduced_failure_json=excluded.reproduced_failure_json,
         updated_at=excluded.updated_at`
    )
    .run(
      changeset.id,
      changeset.originatingFindingId ?? null,
      changeset.originatingResultId ?? null,
      changeset.taskId ?? null,
      JSON.stringify(changeset.files),
      changeset.status,
      changeset.attempts,
      changeset.reason ?? null,
      changeset.planResultId ?? null,
      changeset.repairResultId ?? null,
      changeset.filesChanged ? JSON.stringify(changeset.filesChanged) : null,
      changeset.testResults ? JSON.stringify(changeset.testResults) : null,
      changeset.verification ? JSON.stringify(changeset.verification) : null,
      changeset.reproducedFailure ? JSON.stringify(changeset.reproducedFailure) : null,
      changeset.createdAt,
      changeset.updatedAt
    );
}

export function loadChangeSet(id: string): MaintenanceChangeSet | null {
  ensureMaintenanceTables();
  const row = rawDb
    .prepare(`SELECT * FROM maintenance_change_sets WHERE id = ?`)
    .get(id) as ChangeSetRow | undefined;
  return row ? rowToChangeSet(row) : null;
}

export function listChangeSets(limit = 50): MaintenanceChangeSet[] {
  ensureMaintenanceTables();
  const rows = rawDb
    .prepare(`SELECT * FROM maintenance_change_sets ORDER BY updated_at DESC LIMIT ?`)
    .all(Math.max(1, Math.min(limit, 200))) as ChangeSetRow[];
  return rows.map(rowToChangeSet);
}

/** Load the most recently updated changeSet that is still actionable. */
export function loadPendingChangeSet(): MaintenanceChangeSet | null {
  ensureMaintenanceTables();
  const row = rawDb
    .prepare(
      `SELECT * FROM maintenance_change_sets
        WHERE status IN ('investigating','planning','repairing','testing','verifying','ready_for_approval','approved','committing')
        ORDER BY updated_at DESC LIMIT 1`
    )
    .get() as ChangeSetRow | undefined;
  return row ? rowToChangeSet(row) : null;
}

export type { ChangedFile, MaintenanceTestGate };
