import { logger } from '../utils/logger.js';
import { Router } from 'express';
import { randomUUID } from 'crypto';
import type { LoopDefinition } from '../types.js';
import { executeLoop, loopDefinitions, loopRuns } from '../services/loopEngine.js';

const router = Router();

/* ── GET /api/loops ────────────────────────────────── */
router.get('/', (_req, res) => {
  res.json(loopDefinitions.list());
});

/* ── GET /api/loops/:id ────────────────────────────── */
router.get('/:id', (req, res) => {
  const def = loopDefinitions.get(req.params.id);
  if (!def) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Loop not found' } });
    return;
  }
  res.json(def);
});

/* ── POST /api/loops ───────────────────────────────── */
router.post('/', (req, res) => {
  const { name, description, steps, maxIterations, stopCondition } = req.body;
  if (!name || !steps?.length) {
    res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'name and steps are required' } });
    return;
  }
  const def: LoopDefinition = {
    id: `loop-${randomUUID().slice(0, 9)}`,
    name,
    description,
    steps,
    maxIterations,
    stopCondition,
    createdAt: new Date().toISOString(),
    status: 'draft',
  };
  loopDefinitions.upsert(def);
  res.status(201).json(def);
});

/* ── POST /api/loops/:id/run ───────────────────────── */
router.post('/:id/run', (req, res) => {
  const def = loopDefinitions.get(req.params.id);
  if (!def) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Loop not found' } });
    return;
  }
  if (def.status === 'running') {
    res.status(409).json({ error: { code: 'CONFLICT', message: 'Loop is already running' } });
    return;
  }

  // Update def with run config if provided
  const { maxIterations, stopCondition } = req.body || {};
  if (maxIterations !== undefined) def.maxIterations = maxIterations;
  if (stopCondition !== undefined) def.stopCondition = stopCondition;
  loopDefinitions.upsert(def);

  // Fire and forget — execution happens async
  executeLoop(def).catch(err => logger.error('[Loops] Execution error:', err.message));

  res.status(202).json({ message: 'Loop execution started', loopId: def.id });
});

/* ── GET /api/loops/:id/status ─────────────────────── */
router.get('/:id/status', (req, res) => {
  const def = loopDefinitions.get(req.params.id);
  if (!def) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Loop not found' } });
    return;
  }
  // Find most recent loop run for this definition
  const run = loopRuns.list({ loopId: def.id })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

  res.json({ definition: def, currentRun: run ?? null });
});

/* ── GET /api/loops/runs/all ───────────────────────── */
router.get('/runs/all', (_req, res) => {
  res.json(loopRuns.list());
});

export default router;
