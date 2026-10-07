/**
 * routers/localWorker.ts
 *
 * REST API for the AgenticOS Local Worker subsystem.
 */

import { Router, Request, Response } from 'express';
import { localWorkerManager } from '../domains/localWorker/localWorkerManager.js';
import { localWorkerStore } from '../domains/localWorker/localWorkerStore.js';
import {
  getSupervisorApprovalVerifier,
  getRuntimeDeploymentIdentity,
  approvalHash,
  type ApprovalBinding,
} from '../domains/securitySupervisor/approvalVerifier.js';
import { logger } from '../utils/logger.js';

export const localWorkerRouter = Router();

/**
 * POST /api/worker/tasks
 * Start a new local worker task.
 */
localWorkerRouter.post('/tasks', async (req: Request, res: Response) => {
  try {
    const { goal, origin, conversationId, config, autoApprove } = req.body;
    if (!goal || typeof goal !== 'string') {
      return res.status(400).json({ error: 'Field "goal" (string) is required.' });
    }

    const task = await localWorkerManager.startTask(goal, {
      origin,
      conversationId,
      config,
      autoApprove,
    });

    return res.status(201).json({ success: true, task, ...task });
  } catch (err: any) {
    logger.error('[localWorkerRouter] Error starting task:', err);
    return res.status(500).json({ error: err?.message || String(err) });
  }
});

/**
 * GET /api/worker/tasks
 * List all local worker tasks.
 */
localWorkerRouter.get('/tasks', (_req: Request, res: Response) => {
  try {
    const tasks = localWorkerManager.listTasks();
    return res.json({ success: true, tasks, count: tasks.length });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || String(err) });
  }
});

/**
 * GET /api/worker/tasks/:id
 * Retrieve details for a specific task.
 */
localWorkerRouter.get('/tasks/:id', (req: Request, res: Response) => {
  try {
    const task = localWorkerManager.getTask(req.params.id);
    if (!task) {
      return res.status(404).json({ error: `Task not found: ${req.params.id}` });
    }
    return res.json({ success: true, task, ...task });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || String(err) });
  }
});

/**
 * POST /api/worker/tasks/:id/cancel
 * Cancel an active task.
 */
localWorkerRouter.post('/tasks/:id/cancel', (req: Request, res: Response) => {
  try {
    const success = localWorkerManager.cancelTask(req.params.id);
    if (!success) {
      return res.status(404).json({ error: `Task not found: ${req.params.id}` });
    }
    const updated = localWorkerManager.getTask(req.params.id);
    return res.json({ success: true, task: updated });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || String(err) });
  }
});

/**
 * POST /api/worker/tasks/:id/approve
 * Requires verified signed envelope from out-of-process issuer; plain JSON fails closed.
 */
localWorkerRouter.post('/tasks/:id/approve', (req: Request, res: Response) => {
  const { envelope, payload, signature } = req.body || {};
  const approvalPayload = envelope?.payload || payload;
  const approvalSig = envelope?.signature || signature;

  if (!approvalPayload || !approvalSig) {
    return res.status(503).json({
      error: 'APPROVAL_ISSUER_UNAVAILABLE',
      message: 'Plain client approval is disabled; signed envelope from out-of-process issuer required',
    });
  }

  try {
    const task = localWorkerManager.getTask(req.params.id);
    if (!task) {
      return res.status(404).json({ error: `Task not found: ${req.params.id}` });
    }
    const step = task.plan[task.currentStep];
    const expectedBinding: ApprovalBinding = {
      goalId: task.id,
      graphId: 'local-worker',
      nodeId: step?.id || 'step',
      workerId: 'localWorkerManager',
      operation: 'WORKER_TASK_APPROVE',
      attempt: step?.attempts || 1,
      tool: step?.tool || 'shell.execute',
      scopeHash: approvalHash(step?.arguments || {}),
      argumentHash: approvalHash(step?.arguments || {}),
      previewHash: approvalHash(step?.description || 'Worker step approval'),
      runtimeIncarnation: getRuntimeDeploymentIdentity().incarnation,
      bootTimestamp: getRuntimeDeploymentIdentity().bootTimestamp,
    };

    getSupervisorApprovalVerifier().consume(approvalPayload, approvalSig, expectedBinding);

    // Explicit approval via verified out-of-process envelope:
    if (step) {
      step.approved = true;
    }
    task.pendingApproval = undefined;
    task.status = 'running';
    localWorkerStore.saveTask(task);
    (localWorkerManager as any).runTaskLoop(task.id);

    return res.json({ success: true, task: localWorkerManager.getTask(task.id) });
  } catch (err: any) {
    logger.warn('[localWorkerRouter] Verification failed for task approval:', err);
    return res.status(403).json({
      error: 'APPROVAL_VERIFICATION_FAILED',
      message: err?.message || String(err),
    });
  }
});

/**
 * POST /api/worker/tasks/:id/resume
 * Resume a paused/blocked task.
 */
localWorkerRouter.post('/tasks/:id/resume', (req: Request, res: Response) => {
  try {
    const { approved, envelope, payload, signature } = req.body || {};
    if (approved) {
      const approvalPayload = envelope?.payload || payload;
      const approvalSig = envelope?.signature || signature;
      if (!approvalPayload || !approvalSig) {
        return res.status(503).json({
          error: 'APPROVAL_ISSUER_UNAVAILABLE',
          message: "Plain client JSON ({approved:true}) cannot grant approval; out-of-process issuer is unavailable",
        });
      }
      const task = localWorkerManager.getTask(req.params.id);
      if (!task) return res.status(404).json({ error: `Task not found: ${req.params.id}` });
      const step = task.plan[task.currentStep];
      const expectedBinding: ApprovalBinding = {
        goalId: task.id,
        graphId: 'local-worker',
        nodeId: step?.id || 'step',
        workerId: 'localWorkerManager',
        operation: 'WORKER_TASK_APPROVE',
        attempt: step?.attempts || 1,
        tool: step?.tool || 'shell.execute',
        scopeHash: approvalHash(step?.arguments || {}),
        argumentHash: approvalHash(step?.arguments || {}),
        previewHash: approvalHash(step?.description || 'Worker step approval'),
        runtimeIncarnation: getRuntimeDeploymentIdentity().incarnation,
        bootTimestamp: getRuntimeDeploymentIdentity().bootTimestamp,
      };
      getSupervisorApprovalVerifier().consume(approvalPayload, approvalSig, expectedBinding);
      if (step) step.approved = true;
      task.pendingApproval = undefined;
      task.status = 'running';
      localWorkerStore.saveTask(task);
      (localWorkerManager as any).runTaskLoop(task.id);
      return res.json({ success: true, task: localWorkerManager.getTask(task.id) });
    }
    const success = localWorkerManager.resumeTask(req.params.id, false);
    if (!success) {
      return res.status(400).json({ error: `Task ${req.params.id} cannot be resumed.` });
    }
    const updated = localWorkerManager.getTask(req.params.id);
    return res.json({ success: true, task: updated });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || String(err) });
  }
});

/**
 * GET /api/worker/tasks/:id/result
 * Retrieve structured result for a task.
 */
localWorkerRouter.get('/tasks/:id/result', (req: Request, res: Response) => {
  try {
    const task = localWorkerManager.getTask(req.params.id);
    if (!task) {
      return res.status(404).json({ error: `Task not found: ${req.params.id}` });
    }
    return res.json({
      taskId: task.id,
      status: task.status,
      result: task.result,
      error: task.error,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || String(err) });
  }
});

/**
 * GET /api/worker/tasks/:id/evidence
 * Retrieve all empirical evidence records for a task.
 */
localWorkerRouter.get('/tasks/:id/evidence', (req: Request, res: Response) => {
  try {
    const task = localWorkerManager.getTask(req.params.id);
    if (!task) {
      return res.status(404).json({ error: `Task not found: ${req.params.id}` });
    }
    return res.json({
      taskId: task.id,
      evidence: task.evidence,
      count: task.evidence.length,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || String(err) });
  }
});
