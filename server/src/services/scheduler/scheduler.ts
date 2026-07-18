import * as cron from 'node-cron';
import { db } from '../../db/index.js';
import { enqueueRun } from '../execution/runEngine.js';
import { schedules, tasks } from '../../db/schema.js';
import { eq, and } from 'drizzle-orm';

// Store running cron tasks so we can stop/update them later
const activeCronJobs = new Map<string, cron.ScheduledTask>();

export async function initScheduler() {
  console.log('[Scheduler] Initializing cron jobs from database...');
  
  // Clean up any existing jobs if re-initialized
  activeCronJobs.forEach(job => job.stop());
  activeCronJobs.clear();

  const allSchedules = await db.query.schedules.findMany({
    where: eq(schedules.enabled, true)
  });

  allSchedules.forEach((s) => {
    if (s.cronExpression) {
      registerCronJob(s.id, s.taskId, s.cronExpression, s.timezone);
    }
  });

  console.log(`[Scheduler] Successfully registered ${activeCronJobs.size} active schedules.`);


}

export function registerCronJob(scheduleId: string, taskId: string, expression: string, timezone: string = 'UTC') {
  // Stop existing job if re-registering
  if (activeCronJobs.has(scheduleId)) {
    activeCronJobs.get(scheduleId)?.stop();
    activeCronJobs.delete(scheduleId);
  }

  const job = cron.schedule(expression, async () => {
    console.log(`[Scheduler] Firing scheduled task ${taskId} (Schedule: ${scheduleId})`);
    
    // Check if task exists and get its skillId
    const taskRecord = await db.query.tasks.findFirst({
      where: eq(tasks.id, taskId)
    });
    
    if (!taskRecord) {
      console.warn(`[Scheduler] Task ${taskId} not found. Unregistering cron.`);
      unregisterCronJob(scheduleId);
      return;
    }

    try {
      await enqueueRun({
        taskId,
        trigger: 'schedule',
        input: { skillId: (taskRecord.skillIds as string[])?.[0] }
      });
    } catch (err: any) {
      console.error(`[Scheduler] Failed to enqueue run for task ${taskId}:`, err.message);
    }
  }, {
    timezone: timezone
  });

  activeCronJobs.set(scheduleId, job);
}

export function unregisterCronJob(scheduleId: string) {
  if (activeCronJobs.has(scheduleId)) {
    activeCronJobs.get(scheduleId)?.stop();
    activeCronJobs.delete(scheduleId);
  }
}
