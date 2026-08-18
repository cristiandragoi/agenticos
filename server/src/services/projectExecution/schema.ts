/**
 * projectExecution/schema.ts
 *
 * Canonical Project Execution Data Model — DDL only.
 *
 * Rules:
 *  - All tables use IF NOT EXISTS (idempotent).
 *  - ALTERs wrapped in try/catch (idempotent on existing columns).
 *  - No changes to existing: goals, goal_events, goal_steps, magnitude_runs, etc.
 *  - project_goals is a soft join between projects and existing goals.
 *
 * Hierarchy:
 *   Project → ProjectGoal → ProjectTask (tree) → ExecutionRun → ExecutionResult
 *                                                              → ExecutionEvent
 *                                                              → Verification
 */

import { rawDb } from '../../db/index.js';
import { logger } from '../../utils/logger.js';

export function initProjectExecutionSchema() {
  try {
    rawDb.exec(`
      -- ─────────────────────────────────────────────────────────────────────
      -- PROJECT GOALS
      -- Canonical link between a Project and a Goal (wraps existing goal IDs).
      -- ─────────────────────────────────────────────────────────────────────
      CREATE TABLE IF NOT EXISTS project_goals (
        id            TEXT PRIMARY KEY,
        project_id    TEXT NOT NULL,
        goal_id       TEXT,              -- soft FK to existing goals.id (nullable for non-CodeX goals)
        title         TEXT NOT NULL,
        objective     TEXT,
        priority      TEXT NOT NULL DEFAULT 'medium',
        status        TEXT NOT NULL DEFAULT 'planning',
        success_criteria TEXT,
        created_by    TEXT,
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL,
        completed_at  TEXT,
        metadata      TEXT              -- JSON blob
      );

      CREATE INDEX IF NOT EXISTS idx_pg_project ON project_goals(project_id);
      CREATE INDEX IF NOT EXISTS idx_pg_status   ON project_goals(status);

      -- ─────────────────────────────────────────────────────────────────────
      -- PROJECT TASKS (tree-capable via parent_task_id)
      -- ─────────────────────────────────────────────────────────────────────
      CREATE TABLE IF NOT EXISTS project_tasks (
        id                  TEXT PRIMARY KEY,
        project_id          TEXT NOT NULL,
        goal_id             TEXT NOT NULL,            -- FK to project_goals.id
        parent_task_id      TEXT,                     -- nullable for subtask tree
        title               TEXT NOT NULL,
        description         TEXT,
        task_type           TEXT NOT NULL DEFAULT 'generic',
        status              TEXT NOT NULL DEFAULT 'pending',
        assigned_capability TEXT,                     -- 'codex' | 'magnitude' | 'agent_teams' | 'hermes' | 'jarvis'
        assigned_run_id     TEXT,                     -- current or last execution_runs.id
        priority            TEXT NOT NULL DEFAULT 'medium',
        dependency_ids      TEXT,                     -- JSON array of project_tasks.id
        acceptance_criteria TEXT,
        approval_required   INTEGER NOT NULL DEFAULT 0,
        retry_count         INTEGER NOT NULL DEFAULT 0,
        max_retries         INTEGER NOT NULL DEFAULT 3,
        created_at          TEXT NOT NULL,
        updated_at          TEXT NOT NULL,
        started_at          TEXT,
        completed_at        TEXT,
        metadata            TEXT                      -- JSON blob
      );

      CREATE INDEX IF NOT EXISTS idx_pt_project   ON project_tasks(project_id);
      CREATE INDEX IF NOT EXISTS idx_pt_goal      ON project_tasks(goal_id);
      CREATE INDEX IF NOT EXISTS idx_pt_parent    ON project_tasks(parent_task_id);
      CREATE INDEX IF NOT EXISTS idx_pt_status    ON project_tasks(status);

      -- ─────────────────────────────────────────────────────────────────────
      -- EXECUTION RUNS
      -- Every actual worker invocation gets its own identity.
      -- ─────────────────────────────────────────────────────────────────────
      CREATE TABLE IF NOT EXISTS execution_runs (
        id                  TEXT PRIMARY KEY,
        task_id             TEXT NOT NULL,            -- FK to project_tasks.id
        project_id          TEXT NOT NULL,
        goal_id             TEXT NOT NULL,
        worker_type         TEXT NOT NULL,            -- 'codex' | 'magnitude' | 'agent_teams' | 'hermes'
        agent_instance_id   TEXT,                     -- codex goal_id, magnitude run_id, team run_id, etc.
        provider            TEXT,                     -- actual resolved provider
        model               TEXT,                     -- actual resolved model
        status              TEXT NOT NULL DEFAULT 'queued',
        trigger             TEXT NOT NULL DEFAULT 'manual',
        start_time          TEXT,
        end_time            TEXT,
        final_result_id     TEXT,                     -- FK to execution_results.id
        failure_reason      TEXT,
        cancellation_reason TEXT,
        input_tokens        INTEGER,
        output_tokens       INTEGER,
        estimated_cost      REAL,
        request_id          TEXT,                     -- Jarvis requestId for correlation
        conversation_id     TEXT,                     -- Jarvis conversation for correlation
        created_at          TEXT NOT NULL,
        updated_at          TEXT NOT NULL,
        metadata            TEXT                      -- JSON blob
      );

      CREATE INDEX IF NOT EXISTS idx_er_task      ON execution_runs(task_id);
      CREATE INDEX IF NOT EXISTS idx_er_project   ON execution_runs(project_id);
      CREATE INDEX IF NOT EXISTS idx_er_status    ON execution_runs(status);
      CREATE INDEX IF NOT EXISTS idx_er_worker    ON execution_runs(worker_type);
      CREATE INDEX IF NOT EXISTS idx_er_agent     ON execution_runs(agent_instance_id);
      CREATE INDEX IF NOT EXISTS idx_er_conv      ON execution_runs(conversation_id);

      -- ─────────────────────────────────────────────────────────────────────
      -- EXECUTION RESULTS
      -- Result belongs to a specific run — no global "latest result" lookups.
      -- ─────────────────────────────────────────────────────────────────────
      CREATE TABLE IF NOT EXISTS execution_results (
        id              TEXT PRIMARY KEY,
        run_id          TEXT NOT NULL,                -- FK to execution_runs.id
        task_id         TEXT NOT NULL,
        status          TEXT NOT NULL DEFAULT 'pending',
        summary         TEXT,
        structured_output TEXT,                       -- JSON blob
        artifact_refs   TEXT,                         -- JSON array of file paths / artifact IDs
        created_at      TEXT NOT NULL,
        metadata        TEXT                          -- JSON blob
      );

      CREATE INDEX IF NOT EXISTS idx_exr_run  ON execution_results(run_id);
      CREATE INDEX IF NOT EXISTS idx_exr_task ON execution_results(task_id);

      -- ─────────────────────────────────────────────────────────────────────
      -- EXECUTION EVENTS
      -- Unified event envelope — NOT a status, IS an event.
      -- ─────────────────────────────────────────────────────────────────────
      CREATE TABLE IF NOT EXISTS execution_events (
        id          TEXT PRIMARY KEY,
        timestamp   TEXT NOT NULL,
        project_id  TEXT NOT NULL,
        goal_id     TEXT NOT NULL,
        task_id     TEXT NOT NULL,
        run_id      TEXT NOT NULL,
        worker      TEXT NOT NULL,
        event_type  TEXT NOT NULL,
        payload     TEXT                              -- JSON blob
      );

      CREATE INDEX IF NOT EXISTS idx_ee_run     ON execution_events(run_id);
      CREATE INDEX IF NOT EXISTS idx_ee_task    ON execution_events(task_id);
      CREATE INDEX IF NOT EXISTS idx_ee_project ON execution_events(project_id);
      CREATE INDEX IF NOT EXISTS idx_ee_time    ON execution_events(timestamp);

      -- ─────────────────────────────────────────────────────────────────────
      -- VERIFICATIONS
      -- First-class verification record belonging to a specific run/task.
      -- ─────────────────────────────────────────────────────────────────────
      CREATE TABLE IF NOT EXISTS verifications (
        id                TEXT PRIMARY KEY,
        task_id           TEXT NOT NULL,
        target_run_id     TEXT NOT NULL,              -- the run being verified
        verifier_run_id   TEXT,                       -- the verifier's own execution_runs.id
        verifier_provider TEXT,                       -- actual provider used for verification
        verifier_model    TEXT,                       -- actual model used for verification
        worker_provider   TEXT,                       -- provider of the verified worker
        worker_model      TEXT,                       -- model of the verified worker
        same_provider     INTEGER NOT NULL DEFAULT 0, -- 1 if verifier == worker provider (independence warning)
        verdict           TEXT NOT NULL DEFAULT 'NOT_PROVEN',
        issues            TEXT,                       -- JSON array
        evidence          TEXT,                       -- JSON array
        recommendation    TEXT,
        revision_count    INTEGER NOT NULL DEFAULT 0,
        max_revisions     INTEGER NOT NULL DEFAULT 3,
        created_at        TEXT NOT NULL,
        updated_at        TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_ver_task   ON verifications(task_id);
      CREATE INDEX IF NOT EXISTS idx_ver_run    ON verifications(target_run_id);
      CREATE INDEX IF NOT EXISTS idx_ver_verdict ON verifications(verdict);
    `);

    // Idempotent column migrations for automation linking
    const alterQueries = [
      `ALTER TABLE tasks ADD COLUMN project_id TEXT;`,
      `ALTER TABLE tasks ADD COLUMN project_task_id TEXT;`,
      `ALTER TABLE schedules ADD COLUMN project_id TEXT;`,
      `ALTER TABLE schedules ADD COLUMN project_task_id TEXT;`,
    ];
    for (const q of alterQueries) {
      try {
        rawDb.exec(q);
      } catch {
        // column already exists - expected on subsequent boots
      }
    }

    logger.info('[ProjectExecution] Schema initialized successfully');
  } catch (err: any) {
    logger.error('[ProjectExecution] Schema initialization failed:', err.message);
    throw err;
  }
}

export type TaskStatus =
  | 'pending'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'failed_verification'
  | 'cancelled'
  | 'needs_revision'
  | 'needs_review'
  | 'awaiting_approval';

export type RunStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type VerificationVerdict =
  | 'PASS'
  | 'FAIL'
  | 'NEEDS_REVISION'
  | 'NOT_PROVEN';

export type WorkerType =
  | 'codex'
  | 'codex_builder'
  | 'magnitude'
  | 'agent_teams'
  | 'hermes'
  | 'jarvis'
  | 'deepseek_harness';

export type ActionClass =
  | 'READ_ONLY'
  | 'WRITE_REVERSIBLE'
  | 'CONSEQUENTIAL'
  | 'PROHIBITED';
