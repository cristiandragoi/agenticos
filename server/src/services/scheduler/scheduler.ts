import { logger } from '../../utils/logger.js';
import * as cron from 'node-cron';
import { db } from '../../db/index.js';
import { enqueueRun } from '../execution/runEngine.js';
import { schedules, tasks } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import { rawDb } from '../../db/index.js';
import { routineRepo } from '../routines/store.js';
import { dispatchScheduledExecution, type ScheduleFireRecord } from './scheduleDispatcher.js';

// Store running cron tasks so we can stop/update them later
const activeCronJobs = new Map<string, cron.ScheduledTask>();

// Read a schedule row WITH the routine-bridge columns (rawDb so new columns are
// always available regardless of drizzle query typing).
function readSchedule(scheduleId: string): ScheduleFireRecord | null {
  try {
    routineRepo.ensureTables();
    const row = rawDb.prepare('SELECT * FROM schedules WHERE id = ?').get(scheduleId) as any;
    if (!row) return null;
    return {
      id: row.id,
      taskId: row.task_id,
      executionType: row.execution_type ?? 'legacy_skill',
      routineId: row.routine_id ?? null,
      worker: row.worker ?? null,
      projectId: row.project_id ?? null,
      taskTemplate: row.task_template ? JSON.parse(row.task_template) : null,
      cronExpression: row.cron_expression ?? null,
      timezone: row.timezone ?? 'UTC',
      misfirePolicy: row.misfire_policy ?? 'run_once',
      enabled: !!row.enabled,
      createdAt: row.created_at ?? null,
      lastTriggeredAt: row.last_triggered_at ?? null,
    };
  } catch (err: any) {
    logger.warn(`[Scheduler] readSchedule(${scheduleId}) failed: ${err?.message}`);
    return null;
  }
}

/** Update the schedule's last_triggered_at + outcome/error after a fire. */
function recordTriggerOutcome(scheduleId: string, outcome: string | null, error: string | null): void {
  try {
    rawDb.prepare(`UPDATE schedules SET last_triggered_at = ?, last_outcome = ?, last_error = ? WHERE id = ?`)
      .run(new Date().toISOString(), outcome, error, scheduleId);
  } catch (err: any) {
    logger.warn(`[Scheduler] recordTriggerOutcome(${scheduleId}) failed: ${err?.message}`);
  }
}

export async function initScheduler() {
  logger.info('[Scheduler] Initializing cron jobs from database...');

  // MUST run before any drizzle schedules query: the routine-bridge migration
  // adds execution_type/routine_id/worker/project_id/task_template to the
  // schedules table. The drizzle schema now selects these columns, so querying
  // before the ALTER crashes with "no such column: execution_type".
  routineRepo.ensureTables();

  // Clean up any existing jobs if re-initialized
  activeCronJobs.forEach(job => job.stop());
  activeCronJobs.clear();

  const allSchedules = await db.query.schedules.findMany({});
  const enabled = allSchedules.filter((s) => s.enabled);

  enabled.forEach((s) => {
    if (s.cronExpression) {
      registerCronJob(s.id, s.taskId, s.cronExpression, (s as any).timezone || 'UTC');
    }
  });

  // Misfire recovery: a schedule whose nextRunAt/lastTriggeredAt is in the past
  // (or never fired while downtime elapsed) is recovered exactly once per the
  // misfire policy. Conservative: only run_once fires a single recovery; skip
  // fires none; we never replay N missed occurrences.
  for (const s of enabled) {
    const rec = readSchedule(s.id);
    if (!rec || !rec.cronExpression) continue;
    const misfire = rec.misfirePolicy;
    const lastTriggered = rec.lastTriggeredAt ?? null;
    const now = Date.now();
    // Heuristic: if never triggered AND created more than ~1 interval ago, treat
    // as a possible miss. We can't compute exact cron windows cheaply here, so
    // we stay conservative: only fire recovery when there is NO record of a
    // prior trigger AND the schedule predates now by a safety margin.
    const created = rec.createdAt ?? null;
    if (!lastTriggered && created) {
      const createdMs = new Date(created).getTime();
      if (now - createdMs > 60_000) {
        if (misfire === 'run_once') {
          logger.info(`[Scheduler] Misfire recovery (run_once) for schedule ${s.id}`);
          void fireSchedule(rec, 'recovery');
        } else if (misfire === 'skip') {
          logger.info(`[Scheduler] Misfire skipped (policy=skip) for schedule ${s.id}`);
          recordTriggerOutcome(s.id, null, null);
        }
      }
    }
  }

  logger.info(`[Scheduler] Successfully registered ${activeCronJobs.size} active schedules.`);
}

/** Central fire entry point shared by cron + misfire recovery + run-now. */
export async function fireSchedule(schedule: ScheduleFireRecord, triggerType: 'schedule' | 'manual' | 'recovery'): Promise<void> {
  // Resolve a linked routine (what to run).
  let routine = null;
  if (schedule.routineId) routine = routineRepo.get(schedule.routineId);

  if (schedule.executionType === 'worker_task') {
    // Canonical worker execution — never the legacy skill path.
    const result = await dispatchScheduledExecution(schedule, triggerType, routine);
    recordTriggerOutcome(schedule.id, result.outcome, result.error ?? null);
    if (!result.ok) {
      logger.error(`[Scheduler] Worker schedule ${schedule.id} ${result.outcome}: ${result.error}`);
    }
    return;
  }

  // Legacy skill execution (unchanged behavior).
  const taskRecord = await db.query.tasks.findFirst({ where: eq(tasks.id, schedule.taskId) });
  if (!taskRecord) {
    logger.warn(`[Scheduler] Task ${schedule.taskId} not found. Unregistering cron.`);
    unregisterCronJob(schedule.id);
    return;
  }
  try {
    await enqueueRun({ taskId: schedule.taskId, trigger: 'schedule', input: { skillId: (taskRecord.skillIds as string[])?.[0] } });
    recordTriggerOutcome(schedule.id, 'dispatched', null);
  } catch (err: any) {
    logger.error(`[Scheduler] Failed to enqueue legacy run for task ${schedule.taskId}:`, err.message);
    recordTriggerOutcome(schedule.id, 'dispatch_failed', err.message);
  }
}

export function registerCronJob(scheduleId: string, taskId: string, expression: string, timezone: string = 'UTC') {
  if (activeCronJobs.has(scheduleId)) {
    activeCronJobs.get(scheduleId)?.stop();
    activeCronJobs.delete(scheduleId);
  }

  const job = cron.schedule(expression, async () => {
    logger.info(`[Scheduler] Firing scheduled task ${taskId} (Schedule: ${scheduleId})`);
    const rec = readSchedule(scheduleId);
    if (!rec) {
      logger.warn(`[Scheduler] Schedule ${scheduleId} not found at fire time. Unregistering.`);
      unregisterCronJob(scheduleId);
      return;
    }
    if (!rec.enabled) return; // disabled schedule: no fire
    await fireSchedule(rec, 'schedule');
  }, { timezone });

  activeCronJobs.set(scheduleId, job);
}

export function unregisterCronJob(scheduleId: string) {
  if (activeCronJobs.has(scheduleId)) {
    activeCronJobs.get(scheduleId)?.stop();
    activeCronJobs.delete(scheduleId);
  }
}
