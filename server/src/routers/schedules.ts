import { logger } from '../utils/logger.js';
import { Router } from 'express';
import { db } from '../db/index.js';
import { schedules, tasks } from '../db/schema.js';
import { registerCronJob, unregisterCronJob } from '../services/scheduler/scheduler.js';
import { eq } from 'drizzle-orm';
import crypto from 'crypto';

const router = Router();

/* ── GET /api/schedules ─────────────────────────────────── */
router.get('/', async (req, res) => {
  try {
    const { taskId } = req.query;
    
    let query = db.select().from(schedules);
    if (taskId && typeof taskId === 'string') {
      query = query.where(eq(schedules.taskId, taskId)) as any;
    }
    
    const allSchedules = await query;
    res.json(allSchedules);
  } catch (err: any) {
    logger.error('[Schedules API] Failed to list schedules:', err);
    res.status(500).json({ error: { message: err.message } });
  }
});

/* ── POST /api/schedules ─────────────────────────────────── */
router.post('/', async (req, res) => {
  try {
    const { taskId, skillId, cronExpression, timezone = 'UTC', active = true } = req.body;
    // Routine bridge: new schedules may carry an explicit execution target.
    const executionType = req.body.executionType === 'worker_task' ? 'worker_task' : 'legacy_skill';
    const worker = typeof req.body.worker === 'string' ? req.body.worker : null;
    const projectId = typeof req.body.projectId === 'string' ? req.body.projectId : null;
    const taskTemplate = req.body.taskTemplate && typeof req.body.taskTemplate === 'object' ? req.body.taskTemplate : null;

    if (!taskId || !cronExpression) {
      res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'taskId and cronExpression are required' } });
      return;
    }
    if (executionType === 'worker_task' && !['hermes', 'codex', 'magnitude'].includes(worker)) {
      res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'worker_task schedules require worker: hermes | codex | magnitude' } });
      return;
    }
    if (executionType === 'worker_task' && !projectId) {
      res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'worker_task schedules require a valid projectId' } });
      return;
    }

    // Upsert task if it doesn't exist (temporary hack)
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

    const scheduleId = crypto.randomUUID();
    
    await db.insert(schedules).values({
      id: scheduleId,
      taskId,
      type: 'cron',
      cronExpression,
      timezone,
      enabled: active,
      executionType,
      worker,
      projectId,
      taskTemplate: taskTemplate ? JSON.stringify(taskTemplate) : undefined,
    } as any);

    if (active) {
      registerCronJob(scheduleId, taskId, cronExpression, timezone);
    }

    res.status(201).json({ id: scheduleId, status: 'created', executionType });
  } catch (err: any) {
    logger.error('[Schedules API] Failed to create schedule:', err);
    res.status(500).json({ error: { message: err.message } });
  }
});

/* ── PATCH /api/schedules/:id ────────────────────────────── */
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { active, cronExpression, timezone } = req.body;

    const existing = await db.query.schedules.findFirst({ where: eq(schedules.id, id) });
    if (!existing) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Schedule not found' } });
      return;
    }

    const newEnabled = active !== undefined ? active : existing.enabled;
    const newCron = cronExpression || existing.cronExpression;
    const newTimezone = timezone || existing.timezone;

    await db.update(schedules).set({
      enabled: newEnabled,
      cronExpression: newCron,
      timezone: newTimezone
    }).where(eq(schedules.id, id));

    // Update the cron registry
    if (newEnabled && newCron) {
      registerCronJob(id, existing.taskId, newCron, newTimezone);
    } else {
      unregisterCronJob(id);
    }

    res.json({ id, status: 'updated' });
  } catch (err: any) {
    logger.error('[Schedules API] Failed to update schedule:', err);
    res.status(500).json({ error: { message: err.message } });
  }
});

/* ── DELETE /api/schedules/:id ───────────────────────────── */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    unregisterCronJob(id);
    await db.delete(schedules).where(eq(schedules.id, id));

    res.json({ id, status: 'deleted' });
  } catch (err: any) {
    logger.error('[Schedules API] Failed to delete schedule:', err);
    res.status(500).json({ error: { message: err.message } });
  }
});

export const seedDefaultSchedules = async () => {};

export default router;
