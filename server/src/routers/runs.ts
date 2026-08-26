import { logger } from '../utils/logger.js';
import { Router } from 'express';
import { db } from '../db/index.js';
import { runs, runSteps, tasks } from '../db/schema.js';
import { enqueueRun } from '../services/execution/runEngine.js';
import { eq, desc } from 'drizzle-orm';

const router = Router();

/**
 * Canonical run-input reader: `runs.input` is a JSON-mode column, so drizzle may
 * hand back an object (new canonical writes) or a legacy string. Return a stable
 * JSON string that preserves full structured routing metadata. Legacy prompt-only
 * strings remain readable as-is.
 */
function serializeRunInput(input: unknown): string {
  if (typeof input === 'string') return input;
  if (input !== null && typeof input === 'object') return JSON.stringify(input);
  return '';
}

/* ── POST /api/runs ─────────────────────────────────── */
router.post('/', async (req, res) => {
  try {
    const { taskId, skillId, triggerType = 'manual' } = req.body;
    
    if (!taskId) {
      res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'taskId is required' } });
      return;
    }

    // Upsert task if it doesn't exist (temporary hack until task creation API is fully built)
    const existingTask = await db.query.tasks.findFirst({ where: eq(tasks.id, taskId) });
    if (!existingTask) {
      await db.insert(tasks).values({
        id: taskId,
        title: 'Task ' + taskId.slice(0, 8),
        skillIds: skillId ? [skillId] : ['daily-briefing'],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }

    const runId = await enqueueRun({
      taskId,
      trigger: triggerType,
      input: { ...req.body.input, skillId }
    });

    res.status(202).json({ id: runId, status: 'queued' });
  } catch (err: any) {
    logger.error('[Runs API] Failed to enqueue run:', err);
    res.status(500).json({ error: { message: err.message } });
  }
});

/* ── GET /api/runs ─────────────────────────────────── */
router.get('/', async (req, res) => {
  try {
    const { status } = req.query;
    
    let query = db.select().from(runs).orderBy(desc(runs.createdAt));
    if (status && typeof status === 'string') {
      query = query.where(eq(runs.status, status)) as any;
    }
    
    const allRuns = await query.limit(50);
    const sanitized = allRuns.map((r: any) => ({
      ...r,
      // Canonical API contract: runs.input is a JSON string. Preserve the full
      // structured routing metadata — never collapse it to a bare prompt string.
      input: serializeRunInput(r.input),
    }));
    res.json(sanitized);
  } catch (err: any) {
    logger.error('[Runs API] Failed to list runs:', err);
    res.status(500).json({ error: { message: err.message } });
  }
});

/* ── GET /api/runs/:id ─────────────────────────────── */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const run = await db.query.runs.findFirst({
      where: eq(runs.id, id)
    });

    if (!run) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Run not found' } });
      return;
    }

    const steps = await db.query.runSteps.findMany({
      where: eq(runSteps.runId, id),
      orderBy: (runSteps, { asc }) => [asc(runSteps.startedAt)]
    });

    res.json({ run, steps });
  } catch (err: any) {
    logger.error('[Runs API] Failed to get run:', err);
    res.status(500).json({ error: { message: err.message } });
  }
});

export default router;
