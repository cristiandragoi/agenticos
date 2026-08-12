/**
 * Background Task API — canonical task endpoints (Milestone requirement 4).
 *
 *   GET    /api/background-tasks              list (query: activeOnly=true)
 *   POST   /api/background-tasks              create (dispatches to worker adapter)
 *   GET    /api/background-tasks/summary      counts for the cockpit panel
 *   GET    /api/background-tasks/approvals    pending approvals (task-owned)
 *   GET    /api/background-tasks/:taskId      single task
 *   GET    /api/background-tasks/:taskId/events   SSE task-event stream
 *   POST   /api/background-tasks/:taskId/pause
 *   POST   /api/background-tasks/:taskId/resume
 *   POST   /api/background-tasks/:taskId/stop
 *   POST   /api/background-tasks/:taskId/cancel
 *   POST   /api/background-tasks/:taskId/approval   { choice: 'allow' | 'deny' }
 *
 * Conversation and execution are fully separated: nothing here reacts to
 * chat traffic; only these explicit endpoints mutate task state.
 */
import { Router } from 'express';
import { backgroundTaskManager } from '../services/backgroundTasks/manager.js';
import { backgroundTaskRepo } from '../services/backgroundTasks/store.js';
import { dispatchTask } from '../services/backgroundTasks/adapters.js';
import { hermesApiService } from '../services/hermesApiService.js';
import { codexService } from '../domains/codex/service.js';
import { logger } from '../utils/logger.js';

const router = Router();

router.get('/', (req, res) => {
  try {
    const activeOnly = req.query.activeOnly === 'true';
    const projectId = typeof req.query.projectId === 'string' && req.query.projectId ? req.query.projectId : undefined;
    res.json(backgroundTaskManager.listTasks({ activeOnly, projectId, limit: 100 }));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/summary', (_req, res) => {
  try {
    res.json(backgroundTaskManager.summary());
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/approvals', (_req, res) => {
  try {
    res.json(backgroundTaskManager.listPendingApprovals());
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const {
      title, objective, originalRequest, worker, route, selectedAgent,
      priority, projectId, conversationId, conversationSessionId,
      workspacePath, resumable, metadata, dispatch = true,
    } = req.body || {};

    if (!title || !worker) {
      return res.status(400).json({ error: 'title and worker are required' });
    }
    if (!['hermes', 'codex', 'research', 'team', 'automation', 'revenue'].includes(worker)) {
      return res.status(400).json({ error: `Unknown worker kind: ${worker}` });
    }

    const { task, error } = backgroundTaskManager.createTask({
      title,
      objective: objective || title,
      originalRequest: originalRequest || objective || title,
      route: route || worker,
      selectedAgent: selectedAgent || worker,
      worker,
      priority,
      projectId,
      conversationId,
      conversationSessionId,
      resumable,
      metadata,
    });
    if (!task) return res.status(409).json({ error });

    if (dispatch !== false) {
      // Fire-and-forget: dispatch must not block the HTTP response.
      dispatchTask(task, workspacePath).catch((err: any) => {
        logger.error(`[bg-task] dispatch error for ${task.taskId}: ${err?.message}`);
      });
    }
    res.status(201).json(task);
  } catch (err: any) {
    logger.error(`[bg-task] create failed: ${err?.message}`);
    res.status(500).json({ error: err.message });
  }
});

router.get('/:taskId', (req, res) => {
  const task = backgroundTaskManager.resolveTaskRef(req.params.taskId);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const approval = backgroundTaskManager.getPendingApproval(task.taskId);
  res.json({ ...task, pendingApproval: approval || undefined });
});

router.get('/:taskId/events', (req, res) => {
  const task = backgroundTaskManager.resolveTaskRef(req.params.taskId);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 2000\n\n');

  let lastSeq = Number(req.query.after || 0);
  const send = (evt: any) => {
    res.write(`event: ${evt.kind}\ndata: ${JSON.stringify(evt)}\n\n`);
    lastSeq = evt.sequence;
  };
  // Catch-up from persistence (survives reconnects).
  for (const evt of backgroundTaskRepo.getEvents(task.taskId, lastSeq)) send(evt);

  const listener = (evt: any) => {
    if (evt.taskId !== task.taskId) return;
    if (evt.sequence <= lastSeq) return;
    send(evt);
  };
  backgroundTaskManager.on('task:event', listener);

  const keepalive = setInterval(() => res.write(': keepalive\n\n'), 15000);
  req.on('close', () => {
    clearInterval(keepalive);
    backgroundTaskManager.off('task:event', listener);
  });
});

router.post('/:taskId/pause', async (req, res) => {
  const task = backgroundTaskManager.resolveTaskRef(req.params.taskId);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const result = await backgroundTaskManager.pauseTask(task.taskId);
  if (!result.ok) return res.status(409).json({ error: result.error, task: result.task });
  res.json(result.task);
});

router.post('/:taskId/resume', async (req, res) => {
  const task = backgroundTaskManager.resolveTaskRef(req.params.taskId);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const result = await backgroundTaskManager.resumeTask(task.taskId);
  if (!result.ok) return res.status(409).json({ error: result.error, task: result.task });
  res.json(result.task);
});

router.post('/:taskId/stop', async (req, res) => {
  const task = backgroundTaskManager.resolveTaskRef(req.params.taskId);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const result = await backgroundTaskManager.stopTask(task.taskId, req.body?.reason);
  if (!result.ok) return res.status(409).json({ error: result.error, task: result.task });
  res.json(result.task);
});

router.post('/:taskId/cancel', (req, res) => {
  const task = backgroundTaskManager.resolveTaskRef(req.params.taskId);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const result = backgroundTaskManager.cancelTask(task.taskId, req.body?.reason);
  if (!result.ok) return res.status(409).json({ error: result.error, task: result.task });
  res.json(result.task);
});

// ── Manual Board actions (Project Workspace explicit controls) ───────────
router.post('/:taskId/start', (req, res) => {
  const task = backgroundTaskManager.resolveTaskRef(req.params.taskId);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const result = backgroundTaskManager.startTask(task.taskId);
  if (!result.ok) return res.status(409).json({ error: result.error, task: result.task });
  res.json(result.task);
});

router.post('/:taskId/block', (req, res) => {
  const task = backgroundTaskManager.resolveTaskRef(req.params.taskId);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const result = backgroundTaskManager.blockTask(task.taskId, req.body?.reason);
  if (!result.ok) return res.status(409).json({ error: result.error, task: result.task });
  res.json(result.task);
});

router.post('/:taskId/complete', (req, res) => {
  const task = backgroundTaskManager.resolveTaskRef(req.params.taskId);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const result = backgroundTaskManager.completeTaskManual(task.taskId, req.body?.reason);
  if (!result.ok) return res.status(409).json({ error: result.error, task: result.task });
  res.json(result.task);
});

router.post('/:taskId/approval', async (req, res) => {
  const task = backgroundTaskManager.resolveTaskRef(req.params.taskId);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const choice = req.body?.choice;
  if (choice !== 'allow' && choice !== 'deny') {
    return res.status(400).json({ error: "choice must be 'allow' or 'deny'" });
  }

  const result = await backgroundTaskManager.resolveApproval(task.taskId, choice, async (c) => {
    // Bridge to the real worker approval endpoint. Revenue-pipeline tasks are
    // NOT hermes runs — their approval gate lives inside the pipeline adapter,
    // so never forward a revenue task to the hermes bridge.
    if (task.worker === 'hermes' && task.route !== 'revenue_pipeline' && task.linkedRunId) {
      await hermesApiService.resolveApproval(task.linkedRunId, c);
    } else if ((task.worker === 'codex' || task.worker === 'team') && task.linkedRunId) {
      if (c === 'allow') await codexService.approveAndResume(task.linkedRunId);
      else await codexService.abortGoal(task.linkedRunId);
    }
  });
  if (!result.ok) return res.status(409).json({ error: result.error });
  res.json({ ok: true });
});

// P20 — explicit human approval for a pending human-approval gate. Completes
// the task only when every required gate has passed. Nothing auto-passes.
router.post('/:taskId/gates/:gateId/approve', async (req, res) => {
  const task = backgroundTaskManager.resolveTaskRef(req.params.taskId);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  try {
    const { approveGate } = await import('../services/gates/gateRunner.js');
    const r = await approveGate(task.taskId, req.params.gateId);
    if (!r.ok) return res.status(409).json({ error: r.reason });
    res.json(r);
  } catch (err: any) {
    res.status(500).json({ error: err?.message });
  }
});

// P23 — re-run the gate set after a rework attempt (or on a blocked task).
// If all required gates now pass, the task completes via verifyCompletion.
router.post('/:taskId/gates/verify', async (req, res) => {
  const task = backgroundTaskManager.resolveTaskRef(req.params.taskId);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  try {
    const { runTaskGates } = await import('../services/gates/gateRunner.js');
    const set = await runTaskGates(task.taskId);
    if (set.allRequiredPassed) {
      backgroundTaskManager.verifyCompletion(task.taskId, {
        resultText: task.resultText || 'Re-verification passed.',
        readOnly: false,
        verificationNote: `Completed and verified on re-run: ${set.results.filter((r) => r.status === 'passed').map((r) => r.gateId).join(', ')}.`,
      });
    }
    res.json({ taskId: task.taskId, allRequiredPassed: set.allRequiredPassed, results: set.results });
  } catch (err: any) {
    res.status(500).json({ error: err?.message });
  }
});

export default router;
