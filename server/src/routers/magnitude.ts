import { Router, type Request, type Response } from 'express';
import { magnitudeService } from '../domains/magnitude/service.js';
import { logger } from '../utils/logger.js';
import fs from 'node:fs';

export const magnitudeRouter = Router();

/**
 * POST /api/magnitude/runs
 * Create and launch a Magnitude browser inspection run.
 */
magnitudeRouter.post('/runs', async (req: Request, res: Response) => {
  const { goal, url, actionType = 'inspect', conversationId, projectId, projectTaskId, scheduleExecutionId } = req.body;
  const target = url || goal;

  if (!target || typeof target !== 'string') {
    return res.status(400).json({ error: 'Goal or URL is required.' });
  }

  try {
    const run = magnitudeService.createRun(
      target,
      actionType,
      conversationId,
      { projectId, projectTaskId, scheduleExecutionId },
    );

    // Execute asynchronously
    magnitudeService.executeInspect(run.id).catch((err) => {
      logger.error(`[Magnitude] Run ${run.id} execution failed:`, err);
    });

    return res.status(201).json(run);
  } catch (err: any) {
    logger.error('[Magnitude] Failed to create run:', err);
    return res.status(500).json({ error: err.message || 'Failed to start Magnitude run.' });
  }
});

/**
 * GET /api/magnitude/runs
 * List recent Magnitude runs (optionally scoped to a project — A5).
 */
magnitudeRouter.get('/runs', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const projectId = typeof req.query.projectId === 'string' && req.query.projectId ? req.query.projectId : undefined;
    const runs = magnitudeService.getAllRuns(limit, projectId);
    return res.json(runs);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/magnitude/runs/:id
 * Get full details of a specific Magnitude run.
 */
magnitudeRouter.get('/runs/:id', async (req: Request, res: Response) => {
  try {
    const run = magnitudeService.getRun(req.params.id);
    if (!run) {
      return res.status(404).json({ error: 'Magnitude run not found.' });
    }
    return res.json(run);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/magnitude/runs/:id/stop
 * Stop / abort an active Magnitude run.
 */
magnitudeRouter.post('/runs/:id/stop', async (req: Request, res: Response) => {
  try {
    const stopped = await magnitudeService.cancelRun(req.params.id);
    return res.json({ stopped });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/magnitude/runs/:id/approval
 * Approve or reject an active Magnitude approval request.
 */
magnitudeRouter.post('/runs/:id/approval', async (req: Request, res: Response) => {
  const { approved, reason, responder } = req.body;
  if (typeof approved !== 'boolean') {
    return res.status(400).json({ error: 'approved boolean field is required.' });
  }
  try {
    const success = await magnitudeService.respondApproval(req.params.id, approved, reason, responder);
    return res.json({ success });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/magnitude/runs/:id/screenshot
 * Serve the run's screenshot evidence (M7) — only the exact file recorded on
 * this run is readable; never an arbitrary path.
 */
magnitudeRouter.get('/runs/:id/screenshot', (req: Request, res: Response) => {
  try {
    const run = magnitudeService.getRun(req.params.id);
    if (!run) return res.status(404).json({ error: 'Magnitude run not found.' });
    const recordedPath = run.result?.screenshotPath;
    if (!recordedPath || !run.result?.screenshotBytes) {
      return res.status(404).json({ error: 'No screenshot recorded for this run.' });
    }
    if (!fs.existsSync(recordedPath)) {
      return res.status(404).json({ error: 'Screenshot file missing.' });
    }
    res.set({ 'Content-Type': 'image/png', 'Content-Length': String(run.result.screenshotBytes) });
    return res.send(fs.readFileSync(recordedPath));
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/magnitude/runs/:id/stream
 * Server-Sent Events stream for a Magnitude run.
 */
magnitudeRouter.get('/runs/:id/stream', (req: Request, res: Response) => {
  const runId = req.params.id;
  const run = magnitudeService.getRun(runId);
  if (!run) {
    return res.status(404).json({ error: 'Magnitude run not found.' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  // Send initial state and historical events
  for (const evt of run.events) {
    res.write(`event: magnitude_event\ndata: ${JSON.stringify(evt)}\n\n`);
  }

  if (['completed', 'failed', 'stopped'].includes(run.status)) {
    res.write(`event: done\ndata: ${JSON.stringify({ status: run.status })}\n\n`);
    res.end();
    return;
  }

  const listener = (evt: any) => {
    try {
      res.write(`event: magnitude_event\ndata: ${JSON.stringify(evt)}\n\n`);
      if (['magnitude_completed', 'magnitude_failed', 'magnitude_stopped'].includes(evt.type)) {
        res.write(`event: done\ndata: ${JSON.stringify({ status: evt.type })}\n\n`);
        res.end();
        magnitudeService.removeListener(`event:${runId}`, listener);
      }
    } catch {}
  };

  magnitudeService.on(`event:${runId}`, listener);

  req.on('close', () => {
    magnitudeService.removeListener(`event:${runId}`, listener);
  });
});
