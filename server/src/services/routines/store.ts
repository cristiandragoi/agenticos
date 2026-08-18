/**
 * routines/store.ts — canonical Routine persistence + schedule bridge schema.
 *
 * A Routine is a thin persistent definition that COMPOSES existing capabilities:
 * it does not own scheduling, task lifecycle, execution, verification, or
 * memory — it references them. Source of truth:
 *
 *   Routine definition  → routines table
 *   Trigger             → schedules table (execution_type + routine_id)
 *   Worker task lifecycle → background_tasks
 *   Project execution    → projectExecution (project_goals/tasks, execution_runs/results)
 *   Verification         → verifications
 *   Memory               → memory_records (Project Memory)
 *   Audit               → background_task_events + schedule_executions
 *
 * Idempotent DDL at module load (CREATE TABLE IF NOT EXISTS + guarded ALTER),
 * matching the existing backgroundTasks/memory migration pattern.
 */
import { rawDb } from '../../db/index.js';

export type RoutineWorker = 'hermes' | 'codex' | 'magnitude';
export type ApprovalPolicyRef = 'read_only_auto' | 'require_before_execution' | 'inherit_project_policy';
export type VerificationPolicyRef = 'required' | 'optional' | 'none';

export interface RoutineTaskTemplate {
  objective: string;
  worker: RoutineWorker;
  input?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface RoutineRecord {
  routineId: string;
  projectId: string;
  name: string;
  description: string | null;
  objective: string;
  worker: RoutineWorker;
  taskTemplate: RoutineTaskTemplate;
  scheduleId: string | null;
  enabled: boolean;
  memoryPolicy: { retrieveProjectMemory: boolean; allowCandidatePromotion: boolean };
  approvalPolicy: ApprovalPolicyRef;
  verificationPolicy: VerificationPolicyRef;
  retryPolicy: { maxAttempts: number; backoffSeconds: number } | null;
  timeoutSeconds: number | null;
  outputPolicy: { destination: 'run_history' | 'project_memory' | 'none' } | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
}

export interface ScheduleExecutionRecord {
  id: string;
  scheduleId: string;
  routineId: string | null;
  projectId: string | null;
  backgroundTaskId: string | null;
  projectTaskId: string | null;
  runId: string | null;
  resultId: string | null;
  verificationId: string | null;
  triggeredAt: string;
  triggerType: 'schedule' | 'manual' | 'recovery';
  outcome: 'dispatched' | 'completed' | 'execution_failed' | 'dispatch_failed' | 'cancelled';
  error: string | null;
}

const DDL = `
CREATE TABLE IF NOT EXISTS routines (
  routine_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  objective TEXT NOT NULL DEFAULT '',
  worker TEXT NOT NULL,
  task_template TEXT NOT NULL DEFAULT '{}',
  schedule_id TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  memory_policy TEXT NOT NULL DEFAULT '{"retrieveProjectMemory":true,"allowCandidatePromotion":true}',
  approval_policy TEXT NOT NULL DEFAULT 'inherit_project_policy',
  verification_policy TEXT NOT NULL DEFAULT 'required',
  retry_policy TEXT,
  timeout_seconds INTEGER,
  output_policy TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT
);

CREATE TABLE IF NOT EXISTS schedule_executions (
  id TEXT PRIMARY KEY,
  schedule_id TEXT NOT NULL,
  routine_id TEXT,
  project_id TEXT,
  background_task_id TEXT,
  project_task_id TEXT,
  run_id TEXT,
  result_id TEXT,
  verification_id TEXT,
  triggered_at TEXT NOT NULL,
  trigger_type TEXT NOT NULL DEFAULT 'schedule',
  outcome TEXT NOT NULL DEFAULT 'dispatched',
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_sched_exec_schedule ON schedule_executions(schedule_id, triggered_at);
CREATE INDEX IF NOT EXISTS idx_sched_exec_routine ON schedule_executions(routine_id, triggered_at);
`;

let initialized = false;

function ensureRoutineTables(): void {
  if (initialized) return;
  rawDb.exec(DDL);
  // Migration: schedules table predates the routine bridge. Add the new
  // columns idempotently (CREATE TABLE IF NOT EXISTS does not ALTER).
  const cols = (rawDb.prepare(`PRAGMA table_info(schedules)`).all() as Array<{ name: string }>).map((c) => c.name);
  const add = (name: string, ddl: string) => {
    if (!cols.includes(name)) rawDb.exec(`ALTER TABLE schedules ADD COLUMN ${ddl}`);
  };
  add('execution_type', `execution_type TEXT NOT NULL DEFAULT 'legacy_skill'`);
  add('routine_id', `routine_id TEXT`);
  add('worker', `worker TEXT`);
  add('project_id', `project_id TEXT`);
  add('task_template', `task_template TEXT`);
  add('last_outcome', `last_outcome TEXT`);
  add('last_error', `last_error TEXT`);
  add('created_at', `created_at TEXT`);
  initialized = true;
}

function rowToRoutine(row: any): RoutineRecord {
  return {
    routineId: row.routine_id,
    projectId: row.project_id,
    name: row.name,
    description: row.description,
    objective: row.objective,
    worker: row.worker as RoutineWorker,
    taskTemplate: JSON.parse(row.task_template || '{}'),
    scheduleId: row.schedule_id,
    enabled: !!row.enabled,
    memoryPolicy: JSON.parse(row.memory_policy || '{"retrieveProjectMemory":true,"allowCandidatePromotion":true}'),
    approvalPolicy: row.approval_policy as ApprovalPolicyRef,
    verificationPolicy: row.verification_policy as VerificationPolicyRef,
    retryPolicy: row.retry_policy ? JSON.parse(row.retry_policy) : null,
    timeoutSeconds: row.timeout_seconds,
    outputPolicy: row.output_policy ? JSON.parse(row.output_policy) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
  };
}

function rowToExecution(row: any): ScheduleExecutionRecord {
  return {
    id: row.id,
    scheduleId: row.schedule_id,
    routineId: row.routine_id,
    projectId: row.project_id,
    backgroundTaskId: row.background_task_id,
    projectTaskId: row.project_task_id,
    runId: row.run_id,
    resultId: row.result_id,
    verificationId: row.verification_id,
    triggeredAt: row.triggered_at,
    triggerType: row.trigger_type,
    outcome: row.outcome,
    error: row.error,
  };
}

export const routineRepo = {
  ensureTables: ensureRoutineTables,

  // ── Routines ──────────────────────────────────────────────────────────────

  create(r: RoutineRecord): void {
    ensureRoutineTables();
    rawDb.prepare(`
      INSERT INTO routines (routine_id, project_id, name, description, objective, worker,
        task_template, schedule_id, enabled, memory_policy, approval_policy,
        verification_policy, retry_policy, timeout_seconds, output_policy,
        created_at, updated_at, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      r.routineId, r.projectId, r.name, r.description, r.objective, r.worker,
      JSON.stringify(r.taskTemplate), r.scheduleId, r.enabled ? 1 : 0,
      JSON.stringify(r.memoryPolicy), r.approvalPolicy, r.verificationPolicy,
      r.retryPolicy ? JSON.stringify(r.retryPolicy) : null, r.timeoutSeconds,
      r.outputPolicy ? JSON.stringify(r.outputPolicy) : null,
      r.createdAt, r.updatedAt, r.createdBy,
    );
  },

  get(routineId: string): RoutineRecord | null {
    ensureRoutineTables();
    const row = rawDb.prepare('SELECT * FROM routines WHERE routine_id = ?').get(routineId);
    return row ? rowToRoutine(row) : null;
  },

  list(): RoutineRecord[] {
    ensureRoutineTables();
    return (rawDb.prepare('SELECT * FROM routines ORDER BY created_at DESC').all() as any[]).map(rowToRoutine);
  },

  update(routineId: string, patch: Partial<RoutineRecord>): RoutineRecord | null {
    ensureRoutineTables();
    const existing = this.get(routineId);
    if (!existing) return null;
    const merged: RoutineRecord = { ...existing, ...patch, routineId, updatedAt: new Date().toISOString() };
    rawDb.prepare(`
      UPDATE routines SET project_id=?, name=?, description=?, objective=?, worker=?,
        task_template=?, schedule_id=?, enabled=?, memory_policy=?, approval_policy=?,
        verification_policy=?, retry_policy=?, timeout_seconds=?, output_policy=?,
        updated_at=?, created_by=?
      WHERE routine_id=?
    `).run(
      merged.projectId, merged.name, merged.description, merged.objective, merged.worker,
      JSON.stringify(merged.taskTemplate), merged.scheduleId, merged.enabled ? 1 : 0,
      JSON.stringify(merged.memoryPolicy), merged.approvalPolicy, merged.verificationPolicy,
      merged.retryPolicy ? JSON.stringify(merged.retryPolicy) : null, merged.timeoutSeconds,
      merged.outputPolicy ? JSON.stringify(merged.outputPolicy) : null,
      merged.updatedAt, merged.createdBy, routineId,
    );
    return merged;
  },

  delete(routineId: string): void {
    ensureRoutineTables();
    rawDb.prepare('DELETE FROM routines WHERE routine_id = ?').run(routineId);
  },

  // ── Schedule executions (occurrence provenance) ──────────────────────────

  recordExecution(e: ScheduleExecutionRecord): void {
    ensureRoutineTables();
    // UPSERT: the dispatcher persists the same executionId multiple times as it
    // enriches provenance (dispatched → dispatched+task → final outcome). Each
    // call must update the SAME row, never collide on the PK.
    rawDb.prepare(`
      INSERT INTO schedule_executions
        (id, schedule_id, routine_id, project_id, background_task_id, project_task_id,
         run_id, result_id, verification_id, triggered_at, trigger_type, outcome, error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        schedule_id=excluded.schedule_id, routine_id=excluded.routine_id,
        project_id=excluded.project_id, background_task_id=excluded.background_task_id,
        project_task_id=excluded.project_task_id, run_id=excluded.run_id,
        result_id=excluded.result_id, verification_id=excluded.verification_id,
        triggered_at=excluded.triggered_at, trigger_type=excluded.trigger_type,
        outcome=excluded.outcome, error=excluded.error
    `).run(
      e.id, e.scheduleId, e.routineId, e.projectId, e.backgroundTaskId, e.projectTaskId,
      e.runId, e.resultId, e.verificationId, e.triggeredAt, e.triggerType, e.outcome, e.error,
    );
  },

  updateExecution(id: string, patch: Partial<ScheduleExecutionRecord>): void {
    ensureRoutineTables();
    const existing = this.getExecution(id);
    if (!existing) return;
    const merged = { ...existing, ...patch, id };
    rawDb.prepare(`
      UPDATE schedule_executions SET schedule_id=?, routine_id=?, project_id=?,
        background_task_id=?, project_task_id=?, run_id=?, result_id=?,
        verification_id=?, triggered_at=?, trigger_type=?, outcome=?, error=?
      WHERE id=?
    `).run(
      merged.scheduleId, merged.routineId, merged.projectId, merged.backgroundTaskId,
      merged.projectTaskId, merged.runId, merged.resultId, merged.verificationId,
      merged.triggeredAt, merged.triggerType, merged.outcome, merged.error, id,
    );
  },

  getExecution(id: string): ScheduleExecutionRecord | null {
    ensureRoutineTables();
    const row = rawDb.prepare('SELECT * FROM schedule_executions WHERE id = ?').get(id);
    return row ? rowToExecution(row) : null;
  },

  listExecutionsForRoutine(routineId: string, limit = 100): ScheduleExecutionRecord[] {
    ensureRoutineTables();
    return (rawDb.prepare(
      'SELECT * FROM schedule_executions WHERE routine_id = ? ORDER BY triggered_at DESC LIMIT ?'
    ).all(routineId, Math.max(1, Math.min(200, limit))) as any[]).map(rowToExecution);
  },

  listExecutionsForSchedule(scheduleId: string, limit = 100): ScheduleExecutionRecord[] {
    ensureRoutineTables();
    return (rawDb.prepare(
      'SELECT * FROM schedule_executions WHERE schedule_id = ? ORDER BY triggered_at DESC LIMIT ?'
    ).all(scheduleId, Math.max(1, Math.min(200, limit))) as any[]).map(rowToExecution);
  },
};
