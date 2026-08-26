/**
 * domains/codingRuntime/store.ts — coding run persistence.
 *
 * Runs are stored in their own `coding_runs` table (separate from project
 * memory). NEVER persists secrets, raw auth headers, or hidden reasoning.
 */
import { rawDb } from '../../db/index.js';
function initTable() {
    try {
        rawDb.exec(`
      CREATE TABLE IF NOT EXISTS coding_runs (
        run_id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        project_task_id TEXT NOT NULL,
        background_task_id TEXT,
        execution_run_id TEXT,
        status TEXT NOT NULL,
        runtime TEXT NOT NULL,
        provider_policy_id TEXT,
        workspace TEXT NOT NULL,
        worktree_path TEXT,
        branch TEXT,
        base_commit TEXT,
        base_branch TEXT,
        created TEXT NOT NULL,
        updated TEXT NOT NULL,
        started_at TEXT,
        ended_at TEXT,
        instructions TEXT,
        acceptance_criteria TEXT,
        packet_hash TEXT,
        data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_coding_task ON coding_runs(task_id, created);
      CREATE INDEX IF NOT EXISTS idx_coding_project ON coding_runs(project_id, created);
    `);
    }
    catch (err) {
        // best effort
    }
}
initTable();
export function saveCodingRun(run) {
    const stmt = rawDb.prepare(`
    INSERT INTO coding_runs (
      run_id, task_id, project_id, project_task_id, background_task_id, execution_run_id,
      status, runtime, provider_policy_id, workspace, worktree_path, branch, base_commit, base_branch,
      created, updated, started_at, ended_at, instructions, acceptance_criteria, packet_hash, data
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(run_id) DO UPDATE SET
      status = excluded.status,
      worktree_path = excluded.worktree_path,
      branch = excluded.branch,
      updated = excluded.updated,
      started_at = excluded.started_at,
      ended_at = excluded.ended_at,
      data = excluded.data
  `);
    stmt.run(run.runId, run.taskId, run.projectId, run.projectTaskId, run.backgroundTaskId ?? null, run.executionRunId ?? null, run.status, run.runtime, run.providerPolicyId, run.workspace, run.worktreePath ?? null, run.branch ?? null, run.baseCommit ?? null, run.baseBranch ?? null, run.created, run.updated, run.startedAt ?? null, run.endedAt ?? null, run.instructions, run.acceptanceCriteria ?? null, run.packetHash ?? null, JSON.stringify(run));
}
export function getCodingRun(runId) {
    const row = rawDb.prepare('SELECT data FROM coding_runs WHERE run_id = ?').get(runId);
    if (!row?.data)
        return null;
    try {
        return JSON.parse(row.data);
    }
    catch {
        return null;
    }
}
export function listCodingRuns(projectId, limit = 50) {
    const rows = projectId
        ? rawDb.prepare('SELECT data FROM coding_runs WHERE project_id = ? ORDER BY created DESC LIMIT ?').all(projectId, limit)
        : rawDb.prepare('SELECT data FROM coding_runs ORDER BY created DESC LIMIT ?').all(limit);
    return rows.map((r) => { try {
        return JSON.parse(r.data);
    }
    catch {
        return null;
    } }).filter((r) => r !== null);
}
export function countCodingRuns() {
    const row = rawDb.prepare('SELECT COUNT(*) AS c FROM coding_runs').get();
    return row?.c || 0;
}
