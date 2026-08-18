/**
 * executionRunService.ts
 *
 * CRUD for execution_runs, execution_results, and execution_events tables.
 *
 * Design contract:
 *  - Every worker invocation gets its own run ID.
 *  - Results belong to a specific run — never queried as "latest".
 *  - requestId→taskId→runId→resultId chain is always preserved.
 */

import { randomUUID } from 'crypto';
import { rawDb } from '../../db/index.js';
import type { RunStatus, WorkerType } from './schema.js';

// ── Types ────────────────────────────────────────────────────────────────

export interface ExecutionRunRecord {
  id: string;
  taskId: string;
  projectId: string;
  goalId: string;
  workerType: WorkerType;
  agentInstanceId: string | null;
  provider: string | null;
  model: string | null;
  status: RunStatus;
  trigger: string;
  startTime: string | null;
  endTime: string | null;
  finalResultId: string | null;
  failureReason: string | null;
  cancellationReason: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCost: number | null;
  requestId: string | null;
  conversationId: string | null;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown> | null;
}

export interface ExecutionResultRecord {
  id: string;
  runId: string;
  taskId: string;
  status: string;
  summary: string | null;
  structuredOutput: Record<string, unknown> | null;
  artifactRefs: string[];
  createdAt: string;
  metadata: Record<string, unknown> | null;
}

export interface ExecutionEventRecord {
  id: string;
  timestamp: string;
  projectId: string;
  goalId: string;
  taskId: string;
  runId: string;
  worker: string;
  eventType: string;
  payload: Record<string, unknown> | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────

function parseJson<T>(v: string | null | undefined, fallback: T): T {
  if (!v) return fallback;
  try { return JSON.parse(v); } catch { return fallback; }
}

function rowToRun(row: any): ExecutionRunRecord {
  return {
    id: row.id,
    taskId: row.task_id,
    projectId: row.project_id,
    goalId: row.goal_id,
    workerType: row.worker_type as WorkerType,
    agentInstanceId: row.agent_instance_id ?? null,
    provider: row.provider ?? null,
    model: row.model ?? null,
    status: row.status as RunStatus,
    trigger: row.trigger ?? 'manual',
    startTime: row.start_time ?? null,
    endTime: row.end_time ?? null,
    finalResultId: row.final_result_id ?? null,
    failureReason: row.failure_reason ?? null,
    cancellationReason: row.cancellation_reason ?? null,
    inputTokens: row.input_tokens ?? null,
    outputTokens: row.output_tokens ?? null,
    estimatedCost: row.estimated_cost ?? null,
    requestId: row.request_id ?? null,
    conversationId: row.conversation_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    metadata: parseJson(row.metadata, null),
  };
}

function rowToResult(row: any): ExecutionResultRecord {
  return {
    id: row.id,
    runId: row.run_id,
    taskId: row.task_id,
    status: row.status,
    summary: row.summary ?? null,
    structuredOutput: parseJson(row.structured_output, null),
    artifactRefs: parseJson(row.artifact_refs, []),
    createdAt: row.created_at,
    metadata: parseJson(row.metadata, null),
  };
}

function rowToEvent(row: any): ExecutionEventRecord {
  return {
    id: row.id,
    timestamp: row.timestamp,
    projectId: row.project_id,
    goalId: row.goal_id,
    taskId: row.task_id,
    runId: row.run_id,
    worker: row.worker,
    eventType: row.event_type,
    payload: parseJson(row.payload, null),
  };
}

// ── Service ───────────────────────────────────────────────────────────────

export const executionRunService = {

  // ── Runs ──────────────────────────────────────────────────────────────

  createRun(data: {
    taskId: string;
    projectId: string;
    goalId: string;
    workerType: WorkerType;
    agentInstanceId?: string;
    provider?: string;
    model?: string;
    trigger?: string;
    requestId?: string;
    conversationId?: string;
    metadata?: Record<string, unknown>;
  }): ExecutionRunRecord {
    const id = `er-${randomUUID().slice(0, 10)}`;
    const now = new Date().toISOString();
    rawDb.prepare(`
      INSERT INTO execution_runs
        (id, task_id, project_id, goal_id, worker_type, agent_instance_id, provider, model,
         status, trigger, request_id, conversation_id, created_at, updated_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      data.taskId,
      data.projectId,
      data.goalId,
      data.workerType,
      data.agentInstanceId ?? null,
      data.provider ?? null,
      data.model ?? null,
      data.trigger ?? 'manual',
      data.requestId ?? null,
      data.conversationId ?? null,
      now,
      now,
      data.metadata ? JSON.stringify(data.metadata) : null,
    );
    return this.getRun(id)!;
  },

  getRun(id: string): ExecutionRunRecord | null {
    const row = rawDb.prepare('SELECT * FROM execution_runs WHERE id = ?').get(id);
    return row ? rowToRun(row) : null;
  },

  listRunsForTask(taskId: string): ExecutionRunRecord[] {
    return rawDb.prepare(
      'SELECT * FROM execution_runs WHERE task_id = ? ORDER BY created_at DESC'
    ).all(taskId).map(rowToRun);
  },

  listRunsForProject(projectId: string): ExecutionRunRecord[] {
    return rawDb.prepare(
      'SELECT * FROM execution_runs WHERE project_id = ? ORDER BY created_at DESC'
    ).all(projectId).map(rowToRun);
  },

  updateRun(id: string, patch: Partial<{
    status: RunStatus;
    agentInstanceId: string;
    provider: string;
    model: string;
    startTime: string;
    endTime: string;
    finalResultId: string;
    failureReason: string;
    cancellationReason: string;
    inputTokens: number;
    outputTokens: number;
    estimatedCost: number;
  }>): ExecutionRunRecord | null {
    const now = new Date().toISOString();
    const sets: string[] = ['updated_at = ?'];
    const vals: unknown[] = [now];

    const fieldMap: Record<string, string> = {
      status: 'status',
      agentInstanceId: 'agent_instance_id',
      provider: 'provider',
      model: 'model',
      startTime: 'start_time',
      endTime: 'end_time',
      finalResultId: 'final_result_id',
      failureReason: 'failure_reason',
      cancellationReason: 'cancellation_reason',
      inputTokens: 'input_tokens',
      outputTokens: 'output_tokens',
      estimatedCost: 'estimated_cost',
    };

    for (const [key, col] of Object.entries(fieldMap)) {
      if ((patch as any)[key] !== undefined) {
        sets.push(`${col} = ?`);
        vals.push((patch as any)[key]);
      }
    }
    vals.push(id);
    rawDb.prepare(`UPDATE execution_runs SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    return this.getRun(id);
  },

  // ── Results ───────────────────────────────────────────────────────────

  createResult(data: {
    runId: string;
    taskId: string;
    status?: string;
    summary?: string;
    structuredOutput?: Record<string, unknown>;
    artifactRefs?: string[];
    metadata?: Record<string, unknown>;
  }): ExecutionResultRecord {
    const id = `exr-${randomUUID().slice(0, 10)}`;
    const now = new Date().toISOString();
    rawDb.prepare(`
      INSERT INTO execution_results
        (id, run_id, task_id, status, summary, structured_output, artifact_refs, created_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      data.runId,
      data.taskId,
      data.status ?? 'completed',
      data.summary ?? null,
      data.structuredOutput ? JSON.stringify(data.structuredOutput) : null,
      data.artifactRefs ? JSON.stringify(data.artifactRefs) : JSON.stringify([]),
      now,
      data.metadata ? JSON.stringify(data.metadata) : null,
    );
    // Link result back to run
    rawDb.prepare('UPDATE execution_runs SET final_result_id = ?, updated_at = ? WHERE id = ?')
      .run(id, now, data.runId);
    return this.getResult(id)!;
  },

  getResult(id: string): ExecutionResultRecord | null {
    const row = rawDb.prepare('SELECT * FROM execution_results WHERE id = ?').get(id);
    return row ? rowToResult(row) : null;
  },

  getResultForRun(runId: string): ExecutionResultRecord | null {
    const row = rawDb.prepare(
      'SELECT * FROM execution_results WHERE run_id = ? ORDER BY created_at DESC LIMIT 1'
    ).get(runId);
    return row ? rowToResult(row) : null;
  },

  // ── Events ───────────────────────────────────────────────────────────

  emitEvent(data: {
    projectId: string;
    goalId: string;
    taskId: string;
    runId: string;
    worker: string;
    eventType: string;
    payload?: Record<string, unknown>;
  }): ExecutionEventRecord {
    const id = `ee-${randomUUID().slice(0, 10)}`;
    const now = new Date().toISOString();
    rawDb.prepare(`
      INSERT INTO execution_events
        (id, timestamp, project_id, goal_id, task_id, run_id, worker, event_type, payload)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, now,
      data.projectId, data.goalId, data.taskId, data.runId,
      data.worker, data.eventType,
      data.payload ? JSON.stringify(data.payload) : null,
    );
    return this.getEvent(id)!;
  },

  getEvent(id: string): ExecutionEventRecord | null {
    const row = rawDb.prepare('SELECT * FROM execution_events WHERE id = ?').get(id);
    return row ? rowToEvent(row) : null;
  },

  listEventsForRun(runId: string): ExecutionEventRecord[] {
    return rawDb.prepare(
      'SELECT * FROM execution_events WHERE run_id = ? ORDER BY timestamp ASC'
    ).all(runId).map(rowToEvent);
  },

  listEventsForProject(projectId: string, limit = 100): ExecutionEventRecord[] {
    return rawDb.prepare(
      'SELECT * FROM execution_events WHERE project_id = ? ORDER BY timestamp DESC LIMIT ?'
    ).all(projectId, limit).map(rowToEvent);
  },
};
