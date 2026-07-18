import { enqueueRun } from './src/services/execution/runEngine.js';
import { db } from './src/db/index.js';
import { tasks } from './src/db/schema.js';

async function test() {
  // Insert a mock task
  const taskId = 'task-' + crypto.randomUUID();
  await db.insert(tasks).values({
    id: taskId,
    title: 'Test Daily Briefing',
    skillIds: ['daily-briefing'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
  console.log('Inserted task:', taskId);

  // Enqueue it
  const runId = await enqueueRun({
    taskId,
    trigger: 'manual',
    input: { some: 'data' }
  });
  console.log('Enqueued run:', runId);

  // Start the worker to process it
  const { startRunWorker } = await import('./src/services/execution/runWorker.js');
  startRunWorker();
  console.log('Worker started, watching for execution...');

  // Wait 5 seconds then query the DB
  setTimeout(async () => {
    const { runs, runSteps } = await import('./src/db/schema.js');
    const { eq } = await import('drizzle-orm');
    const runRecord = await db.query.runs.findFirst({ where: eq(runs.id, runId) });
    console.log('Run result:', runRecord);
    
    const steps = await db.query.runSteps.findMany({ where: eq(runSteps.runId, runId) });
    console.log('Run steps:', steps);
    
    process.exit(0);
  }, 5000);
}

test();
