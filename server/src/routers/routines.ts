/**
 * routers/routines.ts — canonical Routine API.
 *
 *   POST   /api/routines             create (optionally with schedule)
 *   GET    /api/routines             list
 *   GET    /api/routines/:id         get
 *   PATCH  /api/routines/:id         update
 *   DELETE /api/routines/:id         delete
 *   POST   /api/routines/:id/run-now immediate occurrence (manual trigger)
 *   POST   /api/routines/:id/enable
 *   POST   /api/routines/:id/disable
 *   GET    /api/routines/:id/runs    occurrence history
 */
import { Router } from 'express';
import { logger } from '../utils/logger.js';
import { routineService, type CreateRoutineInput } from '../services/routines/routineService.js';

const router = Router();

function parseBody(body: any): { ok: true; value: CreateRoutineInput } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'JSON body required.' };
  const { projectId, name, objective, worker } = body;
  if (typeof projectId !== 'string' || !projectId) return { ok: false, error: 'projectId (string) is required.' };
  if (typeof name !== 'string' || !name) return { ok: false, error: 'name (string) is required.' };
  if (typeof objective !== 'string' || !objective) return { ok: false, error: 'objective (string) is required.' };
  if (!['hermes', 'codex', 'magnitude'].includes(worker)) return { ok: false, error: 'worker must be hermes | codex | magnitude.' };
  return {
    ok: true,
    value: {
      projectId,
      name,
      objective,
      worker,
      description: typeof body.description === 'string' ? body.description : undefined,
      taskTemplate: body.taskTemplate && typeof body.taskTemplate === 'object' ? body.taskTemplate : undefined,
      cronExpression: typeof body.cronExpression === 'string' ? body.cronExpression : undefined,
      timezone: typeof body.timezone === 'string' ? body.timezone : undefined,
      enabled: typeof body.enabled === 'boolean' ? body.enabled : true,
      memoryPolicy: body.memoryPolicy && typeof body.memoryPolicy === 'object' ? body.memoryPolicy : undefined,
      approvalPolicy: body.approvalPolicy,
      verificationPolicy: body.verificationPolicy,
      retryPolicy: body.retryPolicy,
      timeoutSeconds: typeof body.timeoutSeconds === 'number' ? body.timeoutSeconds : undefined,
      outputPolicy: body.outputPolicy,
      createdBy: typeof body.createdBy === 'string' ? body.createdBy : undefined,
    } as CreateRoutineInput,
  };
}

router.get('/', (_req, res) => {
  try {
    res.json(routineService.listRoutines());
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const parsed = parseBody(req.body);
    if (!parsed.ok) { const e: string = (parsed as any).error; return res.status(400).json({ error: e }); }
    const routine = await routineService.createRoutine(parsed.value);
    res.status(201).json(routine);
  } catch (err: any) {
    logger.error('[Routines API] create failed:', err.message);
    res.status(400).json({ error: err.message });
  }
});

router.get('/:id', (req, res) => {
  const r = routineService.getRoutine(req.params.id);
  if (!r) return res.status(404).json({ error: 'Routine not found.' });
  res.json(r);
});

router.patch('/:id', (req, res) => {
  try {
    const r = routineService.updateRoutine(req.params.id, req.body || {});
    if (!r) return res.status(404).json({ error: 'Routine not found.' });
    res.json(r);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id', (req, res) => {
  routineService.deleteRoutine(req.params.id);
  res.json({ id: req.params.id, status: 'deleted' });
});

router.post('/:id/run-now', async (req, res) => {
  try {
    const result = await routineService.runNow(req.params.id);
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json({ routineId: req.params.id, status: 'dispatched', triggerType: 'manual', ...(result.provenance || {}) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/enable', async (req, res) => {
  const r = await routineService.setEnabled(req.params.id, true);
  if (!r) return res.status(404).json({ error: 'Routine not found.' });
  res.json({ routineId: r.routineId, enabled: true });
});

router.post('/:id/disable', async (req, res) => {
  const r = await routineService.setEnabled(req.params.id, false);
  if (!r) return res.status(404).json({ error: 'Routine not found.' });
  res.json({ routineId: r.routineId, enabled: false });
});

router.get('/:id/runs', (req, res) => {
  const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 100;
  res.json(routineService.listRuns(req.params.id, Number.isFinite(limit) ? limit : 100));
});

export default router;
