import { Router } from 'express';
import { randomUUID } from 'crypto';
import type { VideoJobRecord, VideoFormat } from '../types.js';
import { videoJobStore, videoJobClients, progressVideoJob } from '../adapters/videoAdapter.js';
import { runStore } from '../services/runStore.js';

const router = Router();

/* ── GET /api/video/jobs ───────────────────────────── */
router.get('/jobs', (_req, res) => {
  res.json(videoJobStore.list());
});

/* ── GET /api/video/jobs/:id ───────────────────────── */
router.get('/jobs/:id', (req, res) => {
  const job = videoJobStore.get(req.params.id);
  if (!job) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Video job not found' } });
    return;
  }
  res.json(job);
});

/* ── POST /api/video/jobs ──────────────────────────── */
router.post('/jobs', (req, res) => {
  const { prompt, format = 'landscape-long', assetRefs, targetDurationSeconds } = req.body;
  if (!prompt) {
    res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'prompt is required' } });
    return;
  }

  const jobId = `vj-${randomUUID().slice(0, 9)}`;
  const runId = `run-${randomUUID().slice(0, 9)}`;
  const now = new Date().toISOString();

  // Create backing run record
  runStore.create({
    id: runId, agentId: 'agent-video', sessionId: randomUUID(),
    workspaceId: 'default', mode: 'task', status: 'running',
    input: `Video job: ${prompt}`, logs: ['[VideoAgent] Job created'],
    events: [], linkedArtifacts: [], createdAt: now, updatedAt: now,
  });

  const job: VideoJobRecord = {
    id: jobId, agentId: 'agent-video',
    request: { prompt, format: format as VideoFormat, assetRefs, targetDurationSeconds },
    stage: 'scripting', status: 'running',
    runId, createdAt: now, updatedAt: now,
  };

  videoJobStore.upsert(job);

  // Start async stage progression
  setTimeout(() => progressVideoJob(jobId), 100);

  res.status(201).json(job);
});

/* ── GET /api/stream/video/:id ─────────────────────── */
router.get('/stream/:id', (req, res) => {
  const jobId = req.params.id;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  if (!videoJobClients.has(jobId)) videoJobClients.set(jobId, []);
  videoJobClients.get(jobId)!.push(res);

  // Send current state immediately
  const job = videoJobStore.get(jobId);
  if (job) {
    res.write(`event: video_stage\ndata: ${JSON.stringify({ stage: job.stage, status: job.status, jobId })}\n\n`);
  }

  req.on('close', () => {
    const current = videoJobClients.get(jobId) || [];
    videoJobClients.set(jobId, current.filter(c => c !== res));
  });
});

export default router;
