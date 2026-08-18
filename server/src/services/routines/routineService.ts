/**
 * routines/routineService.ts — canonical Routine domain logic.
 *
 * Routine owns WHAT to run and its policies; the schedule owns WHEN. This
 * service coordinates the two and is the single authority for enable/disable
 * (routine.enabled is authoritative for whether its schedule may dispatch).
 */
import { randomUUID } from 'crypto';
import { logger } from '../../utils/logger.js';
import { rawDb } from '../../db/index.js';
import { db } from '../../db/index.js';
import { schedules } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import {
  routineRepo, type RoutineRecord, type RoutineWorker, type RoutineTaskTemplate,
} from './store.js';
import { registerCronJob, unregisterCronJob, fireSchedule } from '../scheduler/scheduler.js';
import type { ScheduleFireRecord } from '../scheduler/scheduleDispatcher.js';
import { projectsStore } from '../projectsStore.js';

export interface CreateRoutineInput {
  projectId: string;
  name: string;
  description?: string;
  objective: string;
  worker: RoutineWorker;
  taskTemplate?: Partial<RoutineTaskTemplate>;
  cronExpression?: string;       // if present, a schedule is created
  timezone?: string;
  enabled?: boolean;
  memoryPolicy?: RoutineRecord['memoryPolicy'];
  approvalPolicy?: RoutineRecord['approvalPolicy'];
  verificationPolicy?: RoutineRecord['verificationPolicy'];
  retryPolicy?: RoutineRecord['retryPolicy'];
  timeoutSeconds?: number;
  outputPolicy?: RoutineRecord['outputPolicy'];
  createdBy?: string;
}

function validateWorker(worker: string): RoutineWorker {
  if (worker === 'hermes' || worker === 'codex' || worker === 'magnitude') return worker;
  throw new Error(`Unsupported routine worker: ${worker} (use hermes | codex | magnitude).`);
}

export const routineService = {
  ensureTables: () => routineRepo.ensureTables(),

  async createRoutine(input: CreateRoutineInput): Promise<RoutineRecord> {
    routineRepo.ensureTables();
    // Project ownership is required.
    if (!input.projectId || !projectsStore.getProject(input.projectId)) {
      throw new Error('A valid projectId is required to create a routine.');
    }
    const worker = validateWorker(input.worker);
    const now = new Date().toISOString();
    const routineId = `routine-${randomUUID()}`;

    const template: RoutineTaskTemplate = {
      objective: input.objective,
      worker,
      input: input.taskTemplate?.input ?? {},
      metadata: input.taskTemplate?.metadata ?? {},
    };

    const routine: RoutineRecord = {
      routineId,
      projectId: input.projectId,
      name: input.name,
      description: input.description ?? null,
      objective: input.objective,
      worker,
      taskTemplate: template,
      scheduleId: null,
      enabled: input.enabled ?? true,
      memoryPolicy: input.memoryPolicy ?? { retrieveProjectMemory: true, allowCandidatePromotion: true },
      approvalPolicy: input.approvalPolicy ?? 'inherit_project_policy',
      verificationPolicy: input.verificationPolicy ?? 'required',
      retryPolicy: input.retryPolicy ?? null,
      timeoutSeconds: input.timeoutSeconds ?? null,
      outputPolicy: input.outputPolicy ?? null,
      createdAt: now,
      updatedAt: now,
      createdBy: input.createdBy ?? null,
    };

    // If a cron expression was provided, create the schedule (the "when").
    if (input.cronExpression) {
      const scheduleId = `sched-${randomUUID()}`;
      const timezone = input.timezone ?? 'UTC';
      const taskId = `routinetask-${routineId.slice(-8)}`;
      // Insert a stub legacy task row (schedules.task_id is NOT NULL). The
      // worker_task execution path does NOT use this task; it is a schema
      // anchor only. The real occurrence tasks come from backgroundTasks.
      rawDb.prepare(`
        INSERT INTO tasks (id, title, status, priority, skill_ids, created_at, updated_at)
        VALUES (?, ?, 'draft', 'medium', '[]', ?, ?)
      `).run(taskId, `Routine: ${input.name}`, now, now);

      rawDb.prepare(`
        INSERT INTO schedules (id, task_id, type, timezone, cron_expression, enabled,
          misfire_policy, execution_type, routine_id, worker, project_id, task_template, created_at)
        VALUES (?, ?, 'cron', ?, ?, ?, 'run_once', 'worker_task', ?, ?, ?, ?, ?)
      `).run(scheduleId, taskId, timezone, input.cronExpression, routine.enabled ? 1 : 0,
        routineId, worker, input.projectId, JSON.stringify(template), now);

      routine.scheduleId = scheduleId;
      routineRepo.update(routineId, { scheduleId });
      if (routine.enabled) registerCronJob(scheduleId, taskId, input.cronExpression, timezone);
    }

    routineRepo.create(routine);
    return routine;
  },

  listRoutines(): RoutineRecord[] {
    return routineRepo.list();
  },

  getRoutine(routineId: string): RoutineRecord | null {
    return routineRepo.get(routineId);
  },

  updateRoutine(routineId: string, patch: Partial<CreateRoutineInput>): RoutineRecord | null {
    const existing = routineRepo.get(routineId);
    if (!existing) return null;
    const merged: Partial<RoutineRecord> = {};
    if (patch.name !== undefined) merged.name = patch.name;
    if (patch.description !== undefined) merged.description = patch.description;
    if (patch.objective !== undefined) { merged.objective = patch.objective; merged.taskTemplate = { ...existing.taskTemplate, objective: patch.objective }; }
    if (patch.worker !== undefined) { merged.worker = validateWorker(patch.worker); merged.taskTemplate = { ...existing.taskTemplate, worker: merged.worker! }; }
    if (patch.memoryPolicy) merged.memoryPolicy = patch.memoryPolicy;
    if (patch.approvalPolicy) merged.approvalPolicy = patch.approvalPolicy;
    if (patch.verificationPolicy) merged.verificationPolicy = patch.verificationPolicy;
    if (patch.retryPolicy !== undefined) merged.retryPolicy = patch.retryPolicy;
    if (patch.timeoutSeconds !== undefined) merged.timeoutSeconds = patch.timeoutSeconds;
    if (patch.outputPolicy !== undefined) merged.outputPolicy = patch.outputPolicy;
    if (patch.taskTemplate) merged.taskTemplate = { ...existing.taskTemplate, ...patch.taskTemplate };
    return routineRepo.update(routineId, merged);
  },

  deleteRoutine(routineId: string): void {
    const existing = routineRepo.get(routineId);
    if (existing?.scheduleId) {
      unregisterCronJob(existing.scheduleId);
      rawDb.prepare('DELETE FROM schedules WHERE id = ?').run(existing.scheduleId);
    }
    routineRepo.delete(routineId);
  },

  /** Immediate one-off canonical execution (same dispatch path as cron). */
  async runNow(routineId: string): Promise<{ ok: boolean; error?: string; provenance?: any }> {
    const routine = routineRepo.get(routineId);
    if (!routine) return { ok: false, error: 'Routine not found.' };
    if (!routine.enabled) return { ok: false, error: 'Routine is disabled — enable it before running.' };

    // No schedule? Create a transient fire record (no cron registration, no
    // duplicate timer) and dispatch directly.
    const fire: ScheduleFireRecord = {
      id: routine.scheduleId ?? `adhoc-${routineId}`,
      taskId: 'adhoc',
      executionType: 'worker_task',
      routineId,
      worker: routine.worker,
      projectId: routine.projectId,
      taskTemplate: routine.taskTemplate,
      cronExpression: null,
      timezone: 'UTC',
      misfirePolicy: 'skip',
      enabled: true,
    };

    if (routine.scheduleId) {
      // Schedule exists — fire it as manual (does not create a duplicate timer).
      await fireSchedule(fire, 'manual');
      return { ok: true, provenance: { routineId, scheduleId: routine.scheduleId } };
    }
    // No schedule — dispatch directly via the dispatcher.
    const { dispatchScheduledExecution } = await import('../scheduler/scheduleDispatcher.js');
    const result = await dispatchScheduledExecution(fire, 'manual', routine);
    return { ok: result.ok, error: result.error, provenance: result.provenance };
  },

  /** Routine.enabled is authoritative for whether its schedule may dispatch. */
  async setEnabled(routineId: string, enabled: boolean): Promise<RoutineRecord | null> {
    const routine = routineRepo.get(routineId);
    if (!routine) return null;
    const updated = routineRepo.update(routineId, { enabled });
    if (routine.scheduleId) {
      // Coordinate schedule state with routine state (routine is authoritative).
      rawDb.prepare('UPDATE schedules SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, routine.scheduleId);
      if (enabled) {
        const sched = rawDb.prepare('SELECT * FROM schedules WHERE id = ?').get(routine.scheduleId) as any;
        if (sched?.cron_expression) registerCronJob(routine.scheduleId, sched.task_id, sched.cron_expression, sched.timezone ?? 'UTC');
      } else {
        unregisterCronJob(routine.scheduleId);
      }
    }
    return updated;
  },

  listRuns(routineId: string, limit = 100) {
    const execs = routineRepo.listExecutionsForRoutine(routineId, limit);
    // Enrich with canonical run/verification state where available.
    return execs.map((e) => {
      let verdict: string | null = null;
      let durationMs: number | null = null;
      let status = e.outcome;
      if (e.runId) {
        try {
          const run = rawDb.prepare('SELECT status, start_time, end_time FROM execution_runs WHERE id = ?').get(e.runId) as any;
          if (run) {
            status = run.status ?? status;
            if (run.start_time && run.end_time) {
              durationMs = new Date(run.end_time).getTime() - new Date(run.start_time).getTime();
            }
          }
        } catch { /* non-fatal */ }
      }
      if (e.verificationId) {
        try {
          const v = rawDb.prepare('SELECT verdict FROM verifications WHERE id = ?').get(e.verificationId) as any;
          verdict = v?.verdict ?? null;
        } catch { /* non-fatal */ }
      }
      return {
        triggeredAt: e.triggeredAt,
        triggerType: e.triggerType,
        status,
        worker: (routineRepo.get(routineId)?.worker) ?? null,
        backgroundTaskId: e.backgroundTaskId,
        projectTaskId: e.projectTaskId,
        runId: e.runId,
        resultId: e.resultId,
        verificationId: e.verificationId,
        verdict,
        durationMs,
        error: e.error,
      };
    });
  },
};
