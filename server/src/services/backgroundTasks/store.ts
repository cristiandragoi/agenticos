/**
 * SQLite persistence for the Background Task Manager.
 *
 * Idempotent DDL at module load (CREATE TABLE IF NOT EXISTS) — safe against
 * the existing drizzle-managed tables, no migration tooling changes required.
 * Events are persisted so renderer refresh / backend restart can restore the
 * full audit trail.
 */
import { rawDb } from '../../db/index.js';
import type {
  BackgroundTaskRecord,
  BackgroundTaskEvent,
  TaskStatus,
} from './types.js';

const DDL = `
CREATE TABLE IF NOT EXISTS background_tasks (
  task_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  objective TEXT NOT NULL DEFAULT '',
  original_request TEXT NOT NULL DEFAULT '',
  route TEXT NOT NULL DEFAULT '',
  selected_agent TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'queued',
  priority TEXT NOT NULL DEFAULT 'medium',
  project_id TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  conversation_id TEXT,
  conversation_session_id TEXT,
  worker TEXT NOT NULL,
  linked_run_id TEXT,
  linked_board_card_id TEXT,
  parent_task_id TEXT,
  child_task_ids TEXT NOT NULL DEFAULT '[]',
  current_stage TEXT NOT NULL DEFAULT '',
  progress_message TEXT NOT NULL DEFAULT '',
  files_changed TEXT NOT NULL DEFAULT '[]',
  build_state TEXT NOT NULL DEFAULT 'idle',
  test_state TEXT NOT NULL DEFAULT 'idle',
  verification_state TEXT NOT NULL DEFAULT 'pending',
  approval_state TEXT NOT NULL DEFAULT 'none',
  blocker TEXT,
  last_error TEXT,
  cancellation_requested INTEGER NOT NULL DEFAULT 0,
  resumable INTEGER NOT NULL DEFAULT 0,
  result_text TEXT,
  attempt INTEGER NOT NULL DEFAULT 1,
  metadata TEXT NOT NULL DEFAULT '{}',
  workspace_root TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS background_task_events (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  ts TEXT NOT NULL,
  kind TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '{}',
  sequence INTEGER NOT NULL,
  FOREIGN KEY (task_id) REFERENCES background_tasks(task_id)
);
CREATE INDEX IF NOT EXISTS idx_bg_task_events_task ON background_task_events(task_id, sequence);
`;

let initialized = false;

export function ensureBackgroundTaskTables(): void {
  if (initialized) return;
  rawDb.exec(DDL);
  // Migration: existing databases created before the workspace/file
  // reliability milestone do not have workspace_root. CREATE TABLE IF NOT
  // EXISTS does not ALTER, so guard a one-time ADD COLUMN (same idempotent
  // pattern as the revenue discovery_stop_reason migration).
  try {
    const cols = rawDb.prepare(`PRAGMA table_info(background_tasks)`).all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === 'workspace_root')) {
      rawDb.exec(`ALTER TABLE background_tasks ADD COLUMN workspace_root TEXT NOT NULL DEFAULT ''`);
    }
  } catch { /* fresh DB already has the column via DDL */ }
  initialized = true;
}

function rowToTask(row: any): BackgroundTaskRecord {
  return {
    taskId: row.task_id,
    title: row.title,
    objective: row.objective,
    originalRequest: row.original_request,
    route: row.route,
    selectedAgent: row.selected_agent,
    status: row.status as TaskStatus,
    priority: row.priority,
    projectId: row.project_id,
    createdAt: row.created_at,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    conversationId: row.conversation_id,
    conversationSessionId: row.conversation_session_id,
    worker: row.worker,
    linkedRunId: row.linked_run_id,
    linkedBoardCardId: row.linked_board_card_id,
    parentTaskId: row.parent_task_id,
    childTaskIds: JSON.parse(row.child_task_ids || '[]'),
    currentStage: row.current_stage,
    progressMessage: row.progress_message,
    filesChanged: JSON.parse(row.files_changed || '[]'),
    buildState: row.build_state,
    testState: row.test_state,
    verificationState: row.verification_state,
    approvalState: row.approval_state,
    blocker: row.blocker,
    lastError: row.last_error,
    cancellationRequested: !!row.cancellation_requested,
    resumable: !!row.resumable,
    resultText: row.result_text,
    attempt: row.attempt,
    metadata: JSON.parse(row.metadata || '{}'),
    workspaceRoot: row.workspace_root || '',
  };
}

function rowToEvent(row: any): BackgroundTaskEvent {
  return {
    id: row.id,
    taskId: row.task_id,
    ts: row.ts,
    kind: row.kind,
    summary: row.summary,
    detail: JSON.parse(row.detail || '{}'),
    sequence: row.sequence,
  };
}

export const backgroundTaskRepo = {
  ensureTables: ensureBackgroundTaskTables,

  insertTask(task: BackgroundTaskRecord): void {
    ensureBackgroundTaskTables();
    rawDb.prepare(`
      INSERT INTO background_tasks (
        task_id, title, objective, original_request, route, selected_agent,
        status, priority, project_id, created_at, started_at, updated_at,
        completed_at, conversation_id, conversation_session_id, worker,
        linked_run_id, linked_board_card_id, parent_task_id, child_task_ids,
        current_stage, progress_message, files_changed, build_state, test_state,
        verification_state, approval_state, blocker, last_error,
        cancellation_requested, resumable, result_text, attempt, metadata,
        workspace_root
      ) VALUES (
        @taskId, @title, @objective, @originalRequest, @route, @selectedAgent,
        @status, @priority, @projectId, @createdAt, @startedAt, @updatedAt,
        @completedAt, @conversationId, @conversationSessionId, @worker,
        @linkedRunId, @linkedBoardCardId, @parentTaskId, @childTaskIds,
        @currentStage, @progressMessage, @filesChanged, @buildState, @testState,
        @verificationState, @approvalState, @blocker, @lastError,
        @cancellationRequested, @resumable, @resultText, @attempt, @metadata,
        @workspaceRoot
      )
    `).run({
      ...task,
      childTaskIds: JSON.stringify(task.childTaskIds),
      filesChanged: JSON.stringify(task.filesChanged),
      cancellationRequested: task.cancellationRequested ? 1 : 0,
      resumable: task.resumable ? 1 : 0,
      metadata: JSON.stringify(task.metadata),
      workspaceRoot: task.workspaceRoot || '',
    });
  },

  updateTask(taskId: string, patch: Partial<BackgroundTaskRecord>): BackgroundTaskRecord | null {
    ensureBackgroundTaskTables();
    const existing = this.getTask(taskId);
    if (!existing) return null;
    const merged: BackgroundTaskRecord = {
      ...existing,
      ...patch,
      taskId: existing.taskId, // identity is immutable
      updatedAt: new Date().toISOString(),
    };
    rawDb.prepare(`
      UPDATE background_tasks SET
        title=@title, objective=@objective, original_request=@originalRequest,
        route=@route, selected_agent=@selectedAgent, status=@status,
        priority=@priority, project_id=@projectId, created_at=@createdAt,
        started_at=@startedAt, updated_at=@updatedAt, completed_at=@completedAt,
        conversation_id=@conversationId, conversation_session_id=@conversationSessionId,
        worker=@worker, linked_run_id=@linkedRunId, linked_board_card_id=@linkedBoardCardId,
        parent_task_id=@parentTaskId, child_task_ids=@childTaskIds,
        current_stage=@currentStage, progress_message=@progressMessage,
        files_changed=@filesChanged, build_state=@buildState, test_state=@testState,
        verification_state=@verificationState, approval_state=@approvalState,
        blocker=@blocker, last_error=@lastError,
        cancellation_requested=@cancellationRequested, resumable=@resumable,
        result_text=@resultText, attempt=@attempt, metadata=@metadata,
        workspace_root=@workspaceRoot
      WHERE task_id=@taskId
    `).run({
      ...merged,
      childTaskIds: JSON.stringify(merged.childTaskIds),
      filesChanged: JSON.stringify(merged.filesChanged),
      cancellationRequested: merged.cancellationRequested ? 1 : 0,
      resumable: merged.resumable ? 1 : 0,
      metadata: JSON.stringify(merged.metadata),
      workspaceRoot: merged.workspaceRoot || '',
    });
    return merged;
  },

  getTask(taskId: string): BackgroundTaskRecord | null {
    ensureBackgroundTaskTables();
    const row = rawDb.prepare('SELECT * FROM background_tasks WHERE task_id = ?').get(taskId);
    return row ? rowToTask(row) : null;
  },

  listTasks(opts?: { status?: TaskStatus[]; activeOnly?: boolean; projectId?: string | null; limit?: number }): BackgroundTaskRecord[] {
    ensureBackgroundTaskTables();
    let sql = 'SELECT * FROM background_tasks';
    const params: any[] = [];
    const clauses: string[] = [];
    if (opts?.status?.length) {
      clauses.push(`status IN (${opts.status.map(() => '?').join(',')})`);
      params.push(...opts.status);
    }
    if (opts?.activeOnly) {
      clauses.push(`status IN ('queued','planning','running','waiting_approval','review','paused')`);
    }
    if (opts?.projectId) {
      clauses.push(`project_id = ?`);
      params.push(opts.projectId);
    }
    if (clauses.length) sql += ` WHERE ${clauses.join(' AND ')}`;
    sql += ' ORDER BY created_at DESC';
    if (opts?.limit) sql += ` LIMIT ${Math.max(1, Math.min(200, opts.limit))}`;
    const rows = rawDb.prepare(sql).all(...params);
    return rows.map(rowToTask);
  },

  /** Return the most recent OPERATIONAL events across ALL tasks (for Live Work panel).
   *  Excludes streaming token events (task.progress with detail.streaming=true)
   *  so the panel shows meaningful operational events only, not raw LLM chunks. */
  listRecentEvents(limit = 30): Array<BackgroundTaskEvent & { taskTitle: string; taskWorker: string; taskProjectId?: string | null; taskLinkedRunId?: string | null }> {
    ensureBackgroundTaskTables();
    const rows = rawDb.prepare(`
      SELECT e.*, t.title AS task_title, t.worker AS task_worker,
             t.project_id AS task_project_id, t.linked_run_id AS task_linked_run_id
      FROM background_task_events e
      JOIN background_tasks t ON t.task_id = e.task_id
      WHERE NOT (e.kind = 'task.progress' AND e.detail LIKE '%"streaming":true%')
        AND e.kind NOT IN ('task.queued')
      ORDER BY e.ts DESC
      LIMIT ?
    `).all(Math.max(1, Math.min(100, limit)));
    return rows.map((row: any) => ({
      ...rowToEvent(row),
      taskTitle: row.task_title || '',
      taskWorker: row.task_worker || '',
      taskProjectId: row.task_project_id || null,
      taskLinkedRunId: row.task_linked_run_id || null,
    }));
  },

  insertEvent(evt: BackgroundTaskEvent): void {
    ensureBackgroundTaskTables();
    rawDb.prepare(`
      INSERT INTO background_task_events (id, task_id, ts, kind, summary, detail, sequence)
      VALUES (@id, @taskId, @ts, @kind, @summary, @detail, @sequence)
    `).run({ ...evt, detail: JSON.stringify(evt.detail) });
  },

  getEvents(taskId: string, afterSequence = 0, limit = 500): BackgroundTaskEvent[] {
    ensureBackgroundTaskTables();
    const rows = rawDb.prepare(
      'SELECT * FROM background_task_events WHERE task_id = ? AND sequence > ? ORDER BY sequence ASC LIMIT ?'
    ).all(taskId, afterSequence, limit);
    return rows.map(rowToEvent);
  },

  /** Highest persisted sequence for a task (SSE catch-up cursor). */
  lastSequence(taskId: string): number {
    ensureBackgroundTaskTables();
    const row = rawDb.prepare('SELECT MAX(sequence) AS m FROM background_task_events WHERE task_id = ?').get(taskId) as any;
    return row?.m ?? 0;
  },

  /** Find a task by its worker run id (dedupe on restore/retry). */
  findByLinkedRun(linkedRunId: string): BackgroundTaskRecord | null {
    ensureBackgroundTaskTables();
    const row = rawDb.prepare('SELECT * FROM background_tasks WHERE linked_run_id = ? LIMIT 1').get(linkedRunId);
    return row ? rowToTask(row) : null;
  },
};
