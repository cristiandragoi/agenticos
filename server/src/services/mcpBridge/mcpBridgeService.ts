/**
 * services/mcpBridge/mcpBridgeService.ts
 *
 * AGENTIC OS MCP Bridge — backend authority (Phase 1).
 *
 * The MCP server is a thin STDIO client of THIS service. Every mutating
 * decision (approval, submission, cancellation) is resolved here against
 * canonical Agentic OS state — never from client-provided claims.
 *
 * Reuses (no duplicates):
 *   - projectsStore          (projects + authoritative active project)
 *   - projectTaskService     (canonical goals/tasks)
 *   - executionRunService    (canonical runs/results/events)
 *   - verificationService    (canonical verifier)
 *   - workerAdapters         (codex/magnitude/hermes dispatch)
 *   - actionClassifier       (risk tiers)
 *
 * Staging table `mcp_prepared_tasks` is approval bookkeeping only — it is
 * NOT a second task/run system. Submission creates exactly one canonical
 * project task run through the canonical dispatcher.
 */

import { randomUUID } from 'node:crypto';
import { rawDb } from '../../db/index.js';
import { logger } from '../../utils/logger.js';
import { projectsStore } from '../projectsStore.js';
import { projectTaskService } from '../projectExecution/projectTaskService.js';
import { executionRunService } from '../projectExecution/executionRunService.js';
import { verificationService } from '../projectExecution/verificationService.js';
import { classifyAction, type ActionClass } from '../actionClassifier.js';
import {
  executeCodexTask,
  executeMagnitudeTask,
  executeHermesTask,
  cancelHermesTask,
  isWorkerAvailable,
} from '../../domains/workerAdapters/index.js';
import type { WorkerType } from '../projectExecution/schema.js';
import type { ProjectTaskRecord } from '../projectExecution/projectTaskService.js';

export type BridgeWorker = 'hermes' | 'codex' | 'magnitude';
export type BridgeTaskType = 'research' | 'planning' | 'implementation' | 'verification' | 'browser';

export type ApprovalState = 'pending' | 'approved' | 'rejected' | 'expired';

export interface BridgeConstraints {
  allowSourceChanges: boolean;
  allowBuild: boolean;
  allowRestart: boolean;
  allowDeploy: boolean;
  allowCommit: boolean;
  allowPush: boolean;
  allowNetwork: boolean;
}

export interface PrepareInput {
  projectId: string;
  targetWorker: BridgeWorker;
  taskType: BridgeTaskType;
  title: string;
  prompt: string;
  sourceConversationId?: string | null;
  parentRunId?: string | null;
  workspacePath?: string | null;
  constraints?: Partial<BridgeConstraints>;
  operationId?: string | null;
}

export interface PreparedTaskRecord {
  id: string;
  taskId: string;
  goalId: string;
  projectId: string;
  worker: BridgeWorker;
  taskType: BridgeTaskType;
  title: string;
  prompt: string;
  constraints: BridgeConstraints;
  risk: ActionClass;
  approvalState: ApprovalState;
  expiresAt: string;
  submittedRunId: string | null;
  sourceConversationId: string | null;
  parentRunId: string | null;
  operationId: string | null;
  approvalResponder: string | null;
  approvalReason: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── Worker ↔ task-type pairing (authoritative) ────────────────────────────

const WORKER_TASK_TYPES: Record<BridgeWorker, BridgeTaskType[]> = {
  hermes: ['research', 'planning', 'verification'],
  codex: ['implementation', 'verification'],
  magnitude: ['browser', 'verification'],
};

const DEFAULT_CONSTRAINTS: BridgeConstraints = {
  allowSourceChanges: false,
  allowBuild: false,
  allowRestart: false,
  allowDeploy: false,
  allowCommit: false,
  allowPush: false,
  allowNetwork: false,
};

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24h

// ── Schema (idempotent) ───────────────────────────────────────────────────

let initialized = false;
export function initMcpBridgeSchema(): void {
  if (initialized) return;
  try {
    rawDb.exec(`
      CREATE TABLE IF NOT EXISTS mcp_prepared_tasks (
        id                      TEXT PRIMARY KEY,
        task_id                 TEXT NOT NULL,
        goal_id                 TEXT NOT NULL,
        project_id              TEXT NOT NULL,
        worker                  TEXT NOT NULL,
        task_type               TEXT NOT NULL,
        title                   TEXT NOT NULL,
        prompt                  TEXT NOT NULL,
        constraints             TEXT NOT NULL,
        risk                    TEXT NOT NULL,
        approval_state          TEXT NOT NULL DEFAULT 'pending',
        expires_at              TEXT NOT NULL,
        submitted_run_id        TEXT,
        source_conversation_id  TEXT,
        parent_run_id           TEXT,
        operation_id            TEXT,
        approval_responder      TEXT,
        approval_reason         TEXT,
        approved_at             TEXT,
        created_at              TEXT NOT NULL,
        updated_at              TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_mpt_project ON mcp_prepared_tasks(project_id);
      CREATE INDEX IF NOT EXISTS idx_mpt_state   ON mcp_prepared_tasks(approval_state);
      CREATE INDEX IF NOT EXISTS idx_mpt_task    ON mcp_prepared_tasks(task_id);
      CREATE UNIQUE INDEX IF NOT EXISTS uq_mpt_task ON mcp_prepared_tasks(task_id);
    `);
    initialized = true;
  } catch (err: any) {
    logger.error(`[McpBridge] schema init failed: ${err.message}`);
    throw err;
  }
}

// ── Row mapping ───────────────────────────────────────────────────────────

function rowToPrepared(row: any): PreparedTaskRecord {
  return {
    id: row.id,
    taskId: row.task_id,
    goalId: row.goal_id,
    projectId: row.project_id,
    worker: row.worker,
    taskType: row.task_type,
    title: row.title,
    prompt: row.prompt,
    constraints: { ...DEFAULT_CONSTRAINTS, ...JSON.parse(row.constraints || '{}') },
    risk: row.risk,
    approvalState: row.approval_state,
    expiresAt: row.expires_at,
    submittedRunId: row.submitted_run_id ?? null,
    sourceConversationId: row.source_conversation_id ?? null,
    parentRunId: row.parent_run_id ?? null,
    operationId: row.operation_id ?? null,
    approvalResponder: row.approval_responder ?? null,
    approvalReason: row.approval_reason ?? null,
    approvedAt: row.approved_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getPreparedRow(taskId: string): any | null {
  const row = rawDb.prepare('SELECT * FROM mcp_prepared_tasks WHERE task_id = ?').get(taskId);
  return row ?? null;
}

// ── Validation helpers ────────────────────────────────────────────────────

function assertValidWorkerTaskType(worker: BridgeWorker, taskType: BridgeTaskType): void {
  if (!WORKER_TASK_TYPES[worker]) {
    throw new Error(`Unsupported worker: ${worker}`);
  }
  if (!WORKER_TASK_TYPES[worker].includes(taskType)) {
    throw new Error(`Invalid worker/task-type pairing: ${worker} cannot handle ${taskType} (allowed: ${WORKER_TASK_TYPES[worker].join(', ')})`);
  }
}

function assertWorkspaceAuthorized(project: any, workspacePath: string | null | undefined): void {
  if (!workspacePath) return; // null workspace is allowed (e.g. hermes research)
  const projWs = project?.workspacePath ?? null;
  if (!projWs) {
    throw new Error(`Workspace "${workspacePath}" cannot be authorized: project ${project?.id} has no authorized workspacePath`);
  }
  const norm = (p: string) => p.replace(/[\\/]+$/, '').toLowerCase();
  const ws = norm(workspacePath);
  const base = norm(projWs);
  if (ws !== base && !ws.startsWith(base + '/') && !ws.startsWith(base + '\\')) {
    throw new Error(`Workspace "${workspacePath}" is outside the project's authorized workspace "${projWs}"`);
  }
}

// ── Service ───────────────────────────────────────────────────────────────

export const mcpBridgeService = {
  /** Phase 1A read-only: bounded run list for a project (canonical source). */
  listRuns(projectId: string, opts: { status?: string; worker?: string; limit?: number } = {}): any[] {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 50);
    let rows: any[];
    if (opts.status && opts.worker) {
      rows = rawDb.prepare(
        `SELECT * FROM execution_runs WHERE project_id = ? AND status = ? AND worker_type = ?
         ORDER BY created_at DESC LIMIT ?`
      ).all(projectId, opts.status, opts.worker, limit);
    } else if (opts.status) {
      rows = rawDb.prepare(
        `SELECT * FROM execution_runs WHERE project_id = ? AND status = ?
         ORDER BY created_at DESC LIMIT ?`
      ).all(projectId, opts.status, limit);
    } else if (opts.worker) {
      rows = rawDb.prepare(
        `SELECT * FROM execution_runs WHERE project_id = ? AND worker_type = ?
         ORDER BY created_at DESC LIMIT ?`
      ).all(projectId, opts.worker, limit);
    } else {
      rows = rawDb.prepare(
        `SELECT * FROM execution_runs WHERE project_id = ? ORDER BY created_at DESC LIMIT ?`
      ).all(projectId, limit);
    }
    return rows.map((r: any) => ({
      runId: r.id,
      taskId: r.task_id,
      goalId: r.goal_id,
      projectId: r.project_id,
      worker: r.worker_type,
      agentInstanceId: r.agent_instance_id,
      provider: r.provider,
      model: r.model,
      status: r.status,
      trigger: r.trigger,
      startTime: r.start_time,
      endTime: r.end_time,
      cancellationReason: r.cancellation_reason,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  },

  /** Phase 1A read-only: bounded run detail with project-boundary enforcement. */
  getRunDetail(runId: string, requesterProjectId?: string): any | null {
    const run = executionRunService.getRun(runId);
    if (!run) return null;
    if (requesterProjectId && run.projectId !== requesterProjectId) {
      throw new Error('Project boundary violation: run does not belong to the caller project');
    }
    const result = run.finalResultId ? executionRunService.getResult(run.finalResultId) : null;
    const events = executionRunService.listEventsForRun(run.id).slice(-50);
    const verification = verificationService.getVerificationForRun(run.id) ?? null;
    return {
      runId: run.id,
      taskId: run.taskId,
      goalId: run.goalId,
      projectId: run.projectId,
      worker: run.workerType,
      agentInstanceId: run.agentInstanceId,
      requestedProvider: run.provider,
      resolvedProvider: run.provider,
      resolvedModel: run.model,
      status: run.status,
      trigger: run.trigger,
      startTime: run.startTime,
      endTime: run.endTime,
      failureReason: run.failureReason,
      cancellationReason: run.cancellationReason,
      requestId: run.requestId,
      conversationId: run.conversationId,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      result: result ? {
        id: result.id,
        status: result.status,
        summary: result.summary,
        artifactRefs: result.artifactRefs,
        createdAt: result.createdAt,
      } : null,
      verification: verification ? {
        id: verification.id,
        verdict: verification.verdict,
        issues: verification.issues,
        evidence: verification.evidence,
      } : null,
      recentEvents: events.map((e: any) => ({
        id: e.id,
        eventType: e.eventType,
        worker: e.worker,
        payload: e.payload,
        at: e.createdAt,
      })),
    };
  },

  /** Phase 1A read-only: bounded result with project-boundary enforcement. */
  getRunResult(runId: string, requesterProjectId?: string): any | null {
    const run = executionRunService.getRun(runId);
    if (!run) return null;
    if (requesterProjectId && run.projectId !== requesterProjectId) {
      throw new Error('Project boundary violation: run does not belong to the caller project');
    }
    const result = run.finalResultId ? executionRunService.getResult(run.finalResultId) : null;
    if (!result) return null;
    return {
      runId: run.id,
      taskId: run.taskId,
      projectId: run.projectId,
      worker: run.workerType,
      status: result.status,
      summary: result.summary,
      structuredOutput: result.structuredOutput,
      artifactRefs: result.artifactRefs,
      resultCreatedAt: result.createdAt,
      verification: (() => {
        try {
          const { verificationService } = require('../projectExecution/verificationService.js');
          const v = verificationService.getVerificationForRun(run.id);
          return v ? { verdict: v.verdict, issues: v.issues, evidence: v.evidence } : null;
        } catch { return null; }
      })(),
      providerAttempts: run.provider || run.model ? [{ provider: run.provider, model: run.model }] : [],
    };
  },

  /** Phase 1B: prepare a task — validates, persists, NEVER executes. */
  prepare(input: PrepareInput): PreparedTaskRecord {
    initMcpBridgeSchema();
    const { projectId, targetWorker, taskType, title, prompt } = input;
    if (!projectId) throw new Error('projectId is required');
    if (!title || !title.trim()) throw new Error('title is required');
    if (!prompt || !prompt.trim()) throw new Error('prompt is required');

    const project = projectsStore.getProject(projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);

    assertValidWorkerTaskType(targetWorker, taskType);
    assertWorkspaceAuthorized(project, input.workspacePath ?? null);

    // Contradictory constraints are rejected at prepare time.
    const constraints: BridgeConstraints = { ...DEFAULT_CONSTRAINTS, ...(input.constraints ?? {}) };
    if (taskType === 'implementation' && !constraints.allowSourceChanges) {
      throw new Error('Implementation tasks require constraints.allowSourceChanges=true (authorization must be requested explicitly)');
    }

    // Risk classification through the canonical classifier.
    const cls = classifyAction(prompt, targetWorker, false);
    const risk: ActionClass = cls.actionClass;

    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + DEFAULT_TTL_MS).toISOString();

    // Canonical goal + task records (status pending — no run is created).
    const goalTitle = title.trim().slice(0, 200);
    const goal = projectTaskService.createGoal({
      projectId,
      title: goalTitle,
      objective: `MCP prepared task: ${goalTitle}`,
      priority: 'medium',
      successCriteria: 'Prepared task approved and submitted through the canonical dispatch path.',
      createdBy: 'mcp-bridge',
      metadata: { mcpBridge: true, taskType, sourceConversationId: input.sourceConversationId ?? null, operationId: input.operationId ?? null },
    });

    const task = projectTaskService.createTask({
      projectId,
      goalId: goal.id,
      title: goalTitle,
      description: prompt,
      taskType,
      assignedCapability: targetWorker as WorkerType,
      priority: 'medium',
      acceptanceCriteria: 'Complete the prepared task and return a bounded result.',
      approvalRequired: true,
      metadata: {
        mcpBridge: true,
        constraints,
        risk,
        sourceConversationId: input.sourceConversationId ?? null,
        parentRunId: input.parentRunId ?? null,
        operationId: input.operationId ?? null,
        preparedBy: 'mcp-bridge',
      },
    });

    const preparedId = `mcp-prep-${randomUUID().slice(0, 10)}`;
    rawDb.prepare(`
      INSERT INTO mcp_prepared_tasks
        (id, task_id, goal_id, project_id, worker, task_type, title, prompt, constraints, risk,
         approval_state, expires_at, source_conversation_id, parent_run_id, operation_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)
    `).run(
      preparedId, task.id, goal.id, projectId, targetWorker, taskType, goalTitle, prompt,
      JSON.stringify(constraints), risk, expiresAt,
      input.sourceConversationId ?? null, input.parentRunId ?? null, input.operationId ?? null,
      now, now,
    );

    logger.info(`[McpBridge] prepared ${preparedId} (task ${task.id}) worker=${targetWorker} risk=${risk} approval=pending`);
    return this.getPrepared(task.id)!;
  },

  getPrepared(taskId: string): PreparedTaskRecord | null {
    initMcpBridgeSchema();
    const row = getPreparedRow(taskId);
    return row ? rowToPrepared(row) : null;
  },

  /** Lookup by the prepared-record id (mcp-prep-*) instead of the task id. */
  getPreparedByPreparedId(preparedId: string): PreparedTaskRecord | null {
    initMcpBridgeSchema();
    const row = rawDb.prepare('SELECT * FROM mcp_prepared_tasks WHERE id = ?').get(preparedId);
    return row ? rowToPrepared(row) : null;
  },

  listPendingApprovals(limit = 50): PreparedTaskRecord[] {
    initMcpBridgeSchema();
    const rows = rawDb.prepare(
      `SELECT * FROM mcp_prepared_tasks WHERE approval_state = 'pending'
       ORDER BY created_at ASC LIMIT ?`
    ).all(Math.min(Math.max(limit, 1), 100));
    return rows.map(rowToPrepared);
  },

  /** Authoritative approval resolution (called by the approval UI / endpoints). */
  resolveApproval(taskId: string, approved: boolean, reason?: string, responder = 'user'): PreparedTaskRecord {
    initMcpBridgeSchema();
    const rec = this.getPrepared(taskId);
    if (!rec) throw new Error(`Prepared task not found: ${taskId}`);
    if (rec.submittedRunId) throw new Error('Prepared task already submitted; approval cannot be changed');
    const now = new Date().toISOString();
    const state: ApprovalState = approved ? 'approved' : 'rejected';
    rawDb.prepare(`
      UPDATE mcp_prepared_tasks
      SET approval_state = ?, approval_responder = ?, approval_reason = ?, approved_at = ?, updated_at = ?
      WHERE task_id = ?
    `).run(state, responder, reason ?? null, approved ? now : null, now, taskId);
    logger.info(`[McpBridge] approval ${state} for task ${taskId} responder=${responder}`);
    return this.getPrepared(taskId)!;
  },

  /**
   * Phase 1B: submit an approved prepared task — creates EXACTLY ONE
   * canonical run and dispatches the worker. Idempotent: repeated or
   * concurrent submissions return the SAME run.
   */
  async submit(taskId: string, opts: { requestId?: string } = {}): Promise<{ run: any; prepared: PreparedTaskRecord; alreadySubmitted: boolean }> {
    initMcpBridgeSchema();
    const rec = this.getPrepared(taskId);
    if (!rec) throw new Error(`Prepared task not found: ${taskId}`);

    // Expiry is authoritative server-side.
    if (new Date(rec.expiresAt).getTime() < Date.now()) {
      rawDb.prepare(`UPDATE mcp_prepared_tasks SET approval_state = 'expired', updated_at = ? WHERE task_id = ?`)
        .run(new Date().toISOString(), taskId);
      throw new Error('Prepared task has expired');
    }

    // Idempotency: already submitted → same run.
    if (rec.submittedRunId) {
      const run = executionRunService.getRun(rec.submittedRunId);
      if (run) return { run, prepared: rec, alreadySubmitted: true };
    }

    // Authoritative approval — never accepts a client-provided claim.
    if (rec.approvalState !== 'approved') {
      throw new Error(`Prepared task requires approval (current state: ${rec.approvalState})`);
    }

    const task = projectTaskService.getTask(rec.taskId);
    if (!task) throw new Error(`Canonical task not found: ${rec.taskId}`);

    const requestId = opts.requestId || `mcp-${randomUUID().slice(0, 8)}`;
    const conversationId = rec.sourceConversationId ?? undefined;

    let dispatch: any;
    if (rec.worker === 'codex') {
      dispatch = await executeCodexTask(task, {
        workspacePath: undefined,
        conversationId,
        requestId,
      });
    } else if (rec.worker === 'magnitude') {
      dispatch = await executeMagnitudeTask(task, {
        goal: rec.prompt,
        conversationId,
        requestId,
        approved: true, // approval resolved authoritatively by THIS service
      });
    } else {
      dispatch = await executeHermesTask(task, {
        prompt: rec.prompt,
        conversationId,
        requestId,
        projectId: rec.projectId,
        goalId: rec.goalId,
      });
    }

    const run = dispatch?.run ?? (typeof dispatch === 'object' && dispatch && 'run' in dispatch ? (dispatch as any).run : null);
    if (!run) throw new Error('Worker dispatch did not return a canonical run');

    // Record the submitted run (idempotency anchor). Unique index on task_id
    // guards concurrent double-submission.
    rawDb.prepare(`
      UPDATE mcp_prepared_tasks SET submitted_run_id = ?, updated_at = ? WHERE task_id = ? AND submitted_run_id IS NULL
    `).run(run.id, new Date().toISOString(), taskId);

    logger.info(`[McpBridge] submitted ${taskId} → run ${run.id} worker=${rec.worker}`);
    return { run, prepared: this.getPrepared(taskId)!, alreadySubmitted: false };
  },

  /** Phase 1B: canonical cancellation with worker-specific cleanup. */
  async cancel(runId: string, reason?: string): Promise<{ run: any; workerCancelled: boolean }> {
    const run = executionRunService.getRun(runId);
    if (!run) throw new Error(`Run not found: ${runId}`);

    if (run.status === 'completed' || run.status === 'failed') {
      // Truthful terminal state: cannot cancel a finished run.
      return { run, workerCancelled: false };
    }
    if (run.status === 'cancelled') {
      return { run, workerCancelled: false }; // idempotent
    }

    executionRunService.updateRun(run.id, {
      status: 'cancelled',
      cancellationReason: reason || 'Cancelled via MCP bridge',
      endTime: new Date().toISOString(),
    });
    executionRunService.emitEvent({
      projectId: run.projectId,
      goalId: run.goalId,
      taskId: run.taskId,
      runId: run.id,
      worker: run.workerType,
      eventType: 'RUN_CANCELLED',
      payload: { reason: reason || 'Cancelled via MCP bridge', via: 'mcp-bridge' },
    });

    let workerCancelled = false;
    try {
      if (run.workerType === 'hermes' && run.agentInstanceId) {
        workerCancelled = await cancelHermesTask(run.agentInstanceId, reason);
      }
      // codex goal loop / magnitude have their own canonical cancel paths;
      // the canonical execution_run record is the authority for the bridge.
    } catch (err: any) {
      logger.warn(`[McpBridge] worker cancel error (non-fatal): ${err.message}`);
    }

    return { run: executionRunService.getRun(run.id), workerCancelled };
  },

  /** Phase 1B follow: bounded events after a cursor (1-based event index). */
  followRun(runId: string, afterSequence?: number, maxEvents = 100): { run: any; events: any[]; nextSequence: number } {
    const run = executionRunService.getRun(runId);
    if (!run) throw new Error(`Run not found: ${runId}`);
    // execution_events has no sequence column; the ordered list index is the
    // deterministic cursor (timestamp ASC, stable within a run).
    const all = executionRunService.listEventsForRun(run.id);
    const after = Number.isFinite(afterSequence as number) ? (afterSequence as number) : 0;
    const events = all
      .map((e: any, i: number) => ({ ...e, sequence: i + 1 }))
      .filter((e: any) => e.sequence > after)
      .slice(0, maxEvents)
      .map((e: any) => ({
        id: e.id,
        sequence: e.sequence,
        eventType: e.eventType,
        worker: e.worker,
        payload: e.payload,
        at: e.createdAt,
      }));
    return { run, events, nextSequence: all.length };
  },
};
