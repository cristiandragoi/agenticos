/**
 * routers/mcpBridge.ts — AGENTIC OS MCP Bridge HTTP surface.
 *
 * The MCP server (tools/agenticos-mcp) is a thin STDIO client of these
 * endpoints. All authorization/approval decisions are resolved HERE from
 * server-side state — client-provided `approved` claims are never trusted.
 *
 * Loopback only: the host binds 127.0.0.1:4000; nothing here opens a port.
 */

import { Router, Request, Response } from 'express';
import { mcpBridgeService } from '../services/mcpBridge/mcpBridgeService.js';
import { logger } from '../utils/logger.js';
import type { BridgeWorker, BridgeTaskType } from '../services/mcpBridge/mcpBridgeService.js';

export const mcpBridgeRouter = Router();

// ── Phase 1A — read-only ──────────────────────────────────────────────────

/** GET /api/mcp-bridge/projects/:projectId/runs?status=&worker=&limit= */
mcpBridgeRouter.get('/projects/:projectId/runs', (req: Request, res: Response) => {
  try {
    const projectId = req.params.projectId;
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const worker = typeof req.query.worker === 'string' ? req.query.worker : undefined;
    const limit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 50;
    const runs = mcpBridgeService.listRuns(projectId, { status, worker, limit });
    res.json({ projectId, runs, count: runs.length });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

/** GET /api/mcp-bridge/runs/:runId?projectId= (project boundary enforced) */
mcpBridgeRouter.get('/runs/:runId', (req: Request, res: Response) => {
  try {
    const requesterProjectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
    const detail = mcpBridgeService.getRunDetail(req.params.runId, requesterProjectId);
    if (!detail) { res.status(404).json({ error: 'Run not found' }); return; }
    res.json(detail);
  } catch (err: any) {
    res.status(403).json({ error: err.message });
  }
});

/** GET /api/mcp-bridge/runs/:runId/result?projectId= */
mcpBridgeRouter.get('/runs/:runId/result', (req: Request, res: Response) => {
  try {
    const requesterProjectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
    const result = mcpBridgeService.getRunResult(req.params.runId, requesterProjectId);
    if (!result) { res.status(404).json({ error: 'No result available yet' }); return; }
    res.json(result);
  } catch (err: any) {
    res.status(403).json({ error: err.message });
  }
});

/** GET /api/mcp-bridge/runs/:runId/events?after= */
mcpBridgeRouter.get('/runs/:runId/events', (req: Request, res: Response) => {
  try {
    const after = typeof req.query.after === 'string' ? parseInt(req.query.after, 10) : 0;
    const follow = mcpBridgeService.followRun(req.params.runId, Number.isFinite(after) ? after : 0, 100);
    res.json(follow);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

/** GET /api/mcp-bridge/approvals — pending prepared tasks for the UI. */
mcpBridgeRouter.get('/approvals', (_req: Request, res: Response) => {
  try {
    const limit = typeof _req.query.limit === 'string' ? parseInt(_req.query.limit, 10) : 50;
    res.json({ approvals: mcpBridgeService.listPendingApprovals(limit) });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ── Phase 1B — controlled mutations ───────────────────────────────────────

/** POST /api/mcp-bridge/prepare — validate + persist; NEVER executes. */
mcpBridgeRouter.post('/prepare', (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    const prepared = mcpBridgeService.prepare({
      projectId: body.projectId,
      targetWorker: body.targetWorker as BridgeWorker,
      taskType: body.taskType as BridgeTaskType,
      title: body.title,
      prompt: body.prompt,
      sourceConversationId: body.sourceConversationId ?? null,
      parentRunId: body.parentRunId ?? null,
      workspacePath: body.workspacePath ?? null,
      constraints: body.constraints ?? undefined,
      operationId: body.operationId ?? null,
    });
    res.json({
      preparedTaskId: prepared.id,
      taskId: prepared.taskId,
      goalId: prepared.goalId,
      projectId: prepared.projectId,
      worker: prepared.worker,
      taskType: prepared.taskType,
      risk: prepared.risk,
      approvalState: prepared.approvalState,
      requiredApproval: true,
      requestedPermissions: prepared.constraints,
      promptSummary: prepared.prompt.slice(0, 400),
      expiresAt: prepared.expiresAt,
      executed: false,
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /api/mcp-bridge/tasks/:taskId/approve|reject — authoritative resolution. */
mcpBridgeRouter.post('/tasks/:taskId/approve', (req: Request, res: Response) => {
  try {
    const rec = mcpBridgeService.resolveApproval(req.params.taskId, true, req.body?.reason, req.body?.responder || 'user');
    res.json({ preparedTaskId: rec.id, taskId: rec.taskId, approvalState: rec.approvalState, approved: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

mcpBridgeRouter.post('/tasks/:taskId/reject', (req: Request, res: Response) => {
  try {
    const rec = mcpBridgeService.resolveApproval(req.params.taskId, false, req.body?.reason, req.body?.responder || 'user');
    res.json({ preparedTaskId: rec.id, taskId: rec.taskId, approvalState: rec.approvalState, approved: false });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * POST /api/mcp-bridge/submit — authoritative approval check + EXACTLY ONE
 * canonical run. Idempotent: repeated submissions return the same run.
 * Never accepts a client-provided `approved` flag.
 */
mcpBridgeRouter.post('/submit', async (req: Request, res: Response) => {
  try {
    const { preparedTaskId } = req.body || {};
    if (!preparedTaskId) { res.status(400).json({ error: 'preparedTaskId is required' }); return; }
    const rec = mcpBridgeService.getPreparedByPreparedId(preparedTaskId);
    if (!rec) { res.status(404).json({ error: `Prepared task not found: ${preparedTaskId}` }); return; }
    const result = await mcpBridgeService.submit(rec.taskId, { requestId: req.body?.requestId });
    res.json({
      taskId: rec.taskId,
      runId: result.run.id,
      projectId: result.run.projectId,
      workerId: result.run.workerType,
      status: result.run.status,
      alreadySubmitted: result.alreadySubmitted,
      correlation: {
        preparedTaskId: rec.id,
        sourceConversationId: rec.sourceConversationId,
        parentRunId: rec.parentRunId,
        operationId: rec.operationId,
        goalId: rec.goalId,
        taskId: rec.taskId,
        runId: result.run.id,
        workerId: result.run.workerType,
      },
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /api/mcp-bridge/runs/:runId/cancel — canonical cancellation. */
mcpBridgeRouter.post('/runs/:runId/cancel', async (req: Request, res: Response) => {
  try {
    const result = await mcpBridgeService.cancel(req.params.runId, req.body?.reason);
    res.json({
      runId: req.params.runId,
      status: result.run.status,
      cancellationReason: result.run.cancellationReason,
      workerCancelled: result.workerCancelled,
      terminal: ['completed', 'failed', 'cancelled'].includes(result.run.status),
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

logger.info('[McpBridge] router mounted');
