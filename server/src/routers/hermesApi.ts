/**
 * Hermes Live-Run router — mounted at /api/hermes-api inside the existing
 * backend (port 4000). Thin HTTP surface over hermesApiService:
 *   GET  /api/hermes-api/status                 — profile, gateway, STT/TTS truth
 *   POST /api/hermes-api/runs                   — create a live Hermes run
 *   GET  /api/hermes-api/runs                   — list runs
 *   GET  /api/hermes-api/runs/:id               — run + events (poll)
 *   POST /api/hermes-api/runs/:id/approval      — {choice:'allow'|'deny'}
 *   POST /api/hermes-api/runs/:id/stop          — interrupt
 *   GET  /api/hermes-api/runs/:id/events        — SSE relay of upstream events
 */

import { Router } from 'express';
import { hermesApiService } from '../services/hermesApiService.js';

export const hermesApiRouter = Router();

hermesApiRouter.get('/status', async (_req, res) => {
  try {
    const gateway = await hermesApiService.getStatus();
    // STT/TTS truth mirrors /api/voice/tts/status (Deepgram key presence).
    const deepgramConfigured = Boolean(process.env.DEEPGRAM_API_KEY);
    res.json({
      profile: hermesApiService.getProfile(),
      url: await hermesApiService.getUrl(),
      gateway,
      stt: { configured: deepgramConfigured, provider: deepgramConfigured ? 'deepgram' : 'none' },
      tts: { configured: deepgramConfigured, provider: deepgramConfigured ? 'deepgram' : 'none' },
      activeRuns: hermesApiService.listRuns().filter(r => ['queued', 'running', 'waiting_for_approval', 'stopping'].includes(r.status)).length,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'status failed' });
  }
});

hermesApiRouter.post('/runs', async (req, res) => {
  try {
    const { prompt, cardId, instructions } = req.body || {};
    const record = await hermesApiService.createRun({ prompt, cardId, instructions });
    res.status(202).json(record);
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'run creation failed' });
  }
});

hermesApiRouter.get('/runs', (_req, res) => {
  res.json(hermesApiService.listRuns());
});

hermesApiRouter.get('/runs/:id/events', (req, res) => {
  const record = hermesApiService.getRun(req.params.id);
  if (!record) { res.status(404).json({ error: 'run not found' }); return; }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  let seq = 0;
  const send = (evt: any) => {
    res.write(`id: ${++seq}\nevent: hermes_event\ndata: ${JSON.stringify(evt)}\n\n`);
  };
  // Catch-up replay.
  for (const evt of record.events) send(evt);

  const onEvent = (evt: any, run: any) => { if (run?.id === record.id) send(evt); };
  const onDone = () => { res.write(': stream closed\n\n'); res.end(); };
  hermesApiService.on('hermes:event', onEvent);
  const keepalive = setInterval(() => res.write(': keepalive\n\n'), 25000);
  if (['completed', 'failed', 'cancelled'].includes(record.status)) onDone();

  req.on('close', () => {
    clearInterval(keepalive);
    hermesApiService.off('hermes:event', onEvent);
  });
});

hermesApiRouter.get('/runs/:id', (req, res) => {
  const record = hermesApiService.getRun(req.params.id);
  if (!record) { res.status(404).json({ error: 'run not found' }); return; }
  res.json(record);
});

hermesApiRouter.post('/runs/:id/approval', async (req, res) => {
  try {
    const choice = String(req.body?.choice || '').toLowerCase();
    if (choice !== 'allow' && choice !== 'deny') {
      res.status(400).json({ error: "choice must be 'allow' or 'deny'" });
      return;
    }
    const result = await hermesApiService.resolveApproval(req.params.id, choice);
    res.json(result);
  } catch (err: any) {
    res.status(409).json({ error: err?.message || 'approval failed' });
  }
});

hermesApiRouter.post('/runs/:id/stop', async (req, res) => {
  try {
    await hermesApiService.stopRun(req.params.id);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'stop failed' });
  }
});
