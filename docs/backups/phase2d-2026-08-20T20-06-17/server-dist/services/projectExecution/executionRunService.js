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
// ── Helpers ──────────────────────────────────────────────────────────────
function parseJson(v, fallback) {
    if (!v)
        return fallback;
    try {
        return JSON.parse(v);
    }
    catch {
        return fallback;
    }
}
function rowToRun(row) {
    return {
        id: row.id,
        taskId: row.task_id,
        projectId: row.project_id,
        goalId: row.goal_id,
        workerType: row.worker_type,
        agentInstanceId: row.agent_instance_id ?? null,
        provider: row.provider ?? null,
        model: row.model ?? null,
        status: row.status,
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
function rowToResult(row) {
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
function rowToEvent(row) {
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
    createRun(data) {
        const id = `er-${randomUUID().slice(0, 10)}`;
        const now = new Date().toISOString();
        rawDb.prepare(`
      INSERT INTO execution_runs
        (id, task_id, project_id, goal_id, worker_type, agent_instance_id, provider, model,
         status, trigger, request_id, conversation_id, created_at, updated_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?)
    `).run(id, data.taskId, data.projectId, data.goalId, data.workerType, data.agentInstanceId ?? null, data.provider ?? null, data.model ?? null, data.trigger ?? 'manual', data.requestId ?? null, data.conversationId ?? null, now, now, data.metadata ? JSON.stringify(data.metadata) : null);
        return this.getRun(id);
    },
    getRun(id) {
        const row = rawDb.prepare('SELECT * FROM execution_runs WHERE id = ?').get(id);
        return row ? rowToRun(row) : null;
    },
    listRunsForTask(taskId) {
        return rawDb.prepare('SELECT * FROM execution_runs WHERE task_id = ? ORDER BY created_at DESC').all(taskId).map(rowToRun);
    },
    listRunsForProject(projectId) {
        return rawDb.prepare('SELECT * FROM execution_runs WHERE project_id = ? ORDER BY created_at DESC').all(projectId).map(rowToRun);
    },
    updateRun(id, patch) {
        const now = new Date().toISOString();
        const sets = ['updated_at = ?'];
        const vals = [now];
        const fieldMap = {
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
            if (patch[key] !== undefined) {
                sets.push(`${col} = ?`);
                vals.push(patch[key]);
            }
        }
        vals.push(id);
        rawDb.prepare(`UPDATE execution_runs SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
        return this.getRun(id);
    },
    // ── Results ───────────────────────────────────────────────────────────
    createResult(data) {
        const id = `exr-${randomUUID().slice(0, 10)}`;
        const now = new Date().toISOString();
        rawDb.prepare(`
      INSERT INTO execution_results
        (id, run_id, task_id, status, summary, structured_output, artifact_refs, created_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, data.runId, data.taskId, data.status ?? 'completed', data.summary ?? null, data.structuredOutput ? JSON.stringify(data.structuredOutput) : null, data.artifactRefs ? JSON.stringify(data.artifactRefs) : JSON.stringify([]), now, data.metadata ? JSON.stringify(data.metadata) : null);
        // Link result back to run
        rawDb.prepare('UPDATE execution_runs SET final_result_id = ?, updated_at = ? WHERE id = ?')
            .run(id, now, data.runId);
        return this.getResult(id);
    },
    getResult(id) {
        const row = rawDb.prepare('SELECT * FROM execution_results WHERE id = ?').get(id);
        return row ? rowToResult(row) : null;
    },
    getResultForRun(runId) {
        const row = rawDb.prepare('SELECT * FROM execution_results WHERE run_id = ? ORDER BY created_at DESC LIMIT 1').get(runId);
        return row ? rowToResult(row) : null;
    },
    // ── Events ───────────────────────────────────────────────────────────
    emitEvent(data) {
        const id = `ee-${randomUUID().slice(0, 10)}`;
        const now = new Date().toISOString();
        rawDb.prepare(`
      INSERT INTO execution_events
        (id, timestamp, project_id, goal_id, task_id, run_id, worker, event_type, payload)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, now, data.projectId, data.goalId, data.taskId, data.runId, data.worker, data.eventType, data.payload ? JSON.stringify(data.payload) : null);
        return this.getEvent(id);
    },
    getEvent(id) {
        const row = rawDb.prepare('SELECT * FROM execution_events WHERE id = ?').get(id);
        return row ? rowToEvent(row) : null;
    },
    listEventsForRun(runId) {
        return rawDb.prepare('SELECT * FROM execution_events WHERE run_id = ? ORDER BY timestamp ASC').all(runId).map(rowToEvent);
    },
    listEventsForProject(projectId, limit = 100) {
        return rawDb.prepare('SELECT * FROM execution_events WHERE project_id = ? ORDER BY timestamp DESC LIMIT ?').all(projectId, limit).map(rowToEvent);
    },
};
