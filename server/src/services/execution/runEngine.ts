import { db } from '../../db/index.js';
import { runs } from '../../db/schema.js';

export async function enqueueRun(params: { taskId: string, trigger: string, input?: Record<string, unknown> }) {
  const runId = crypto.randomUUID();
  await db.insert(runs).values({
    id: runId,
    taskId: params.taskId,
    trigger: params.trigger,
    status: 'queued',
    attempt: 1,
    input: params.input,
    createdAt: new Date().toISOString(),
  });
  return runId;
}
