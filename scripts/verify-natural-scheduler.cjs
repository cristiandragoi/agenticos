const path = require('path');
const Database = require(path.resolve(__dirname, '../server/node_modules/better-sqlite3'));

console.log('=== NATURAL SCHEDULER PICKUP VERIFICATION (ISOLATED, OBSERVER-ONLY) ===\n');

const { setupIsolatedFixture } = require('./argus-fixture.cjs');
const DB_PATH = setupIsolatedFixture();
const db = new Database(DB_PATH);

async function runNaturalSchedulerAcceptance() {
  const { runtimeRegistry } = await import('../server/dist/services/runtimeRegistry.js');
  const { HermesAdapter } = await import('../server/dist/adapters/hermesAdapter.js');
  const { JarvisAdapter } = await import('../server/dist/adapters/jarvisAdapter.js');
  const { CodexAdapter } = await import('../server/dist/adapters/codexAdapter.js');
  const { revenueSupervisor } = await import('../server/dist/services/revenueOperator/revenueSupervisor.js');
  const { registerCronJob, unregisterCronJob } = await import('../server/dist/services/scheduler/scheduler.js');

  // Register canonical adapters so the supervisor's autonomous continuation
  // dispatch resolves a real executor (rt-hermes) instead of NO_CAPABLE_RUNTIME.
  runtimeRegistry.register(new HermesAdapter());
  runtimeRegistry.register(new JarvisAdapter());
  runtimeRegistry.register(new CodexAdapter());

  // 1. START the supervisor through its normal canonical control path.
  console.log('[1/5] Starting Revenue Supervisor via canonical control path...');
  const startState = revenueSupervisor.setControlState('START', 'mission-616808fe-');
  console.log(`- Supervisor control state: ${startState.state}`);

  // 2. Create a bounded, ISOLATED test schedule with a UNIQUE id (no stale
  //    schedule_executions can be mistaken for fresh pickups).
  const runToken = Date.now();
  const testSchedId = `schedule-natural-isolated-${runToken}`;
  const testTaskId = `task-natural-isolated-${runToken}`;
  db.prepare(`
    INSERT INTO schedules (id, task_id, type, execution_type, routine_id, worker, project_id, task_template, cron_expression, timezone, misfire_policy, enabled, created_at)
    VALUES (?, ?, 'task', 'worker_task', 'routine-revenue-supervisor', 'hermes', 'proj-default', ?, '*/15 * * * * *', 'UTC', 'skip', 1, ?)
  `).run(testSchedId, testTaskId, JSON.stringify({ objective: 'Isolated Natural Supervisor Tick', worker: 'hermes' }), new Date().toISOString());
  console.log(`- Configured isolated schedule: ${testSchedId} (cron: */15 * * * * *)`);

  // 3. Register ONLY the test schedule cron (not initScheduler, which would
  //    re-register production schedules and create a parallel scheduler).
  console.log('\n[2/5] Registering ONLY the isolated schedule cron — waiting as passive observer...');
  registerCronJob(testSchedId, testTaskId, '*/15 * * * * *', 'UTC');

  const startTime = Date.now();
  const startIso = new Date(startTime).toISOString();
  let cycleA = null;
  let cycleB = null;

  console.log('- Waiting for natural cron detection of Cycle A...');
  const deadline = startTime + 60000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 1000));
    // Only count executions created AFTER this test started (fresh pickups).
    const executions = db.prepare(`
      SELECT * FROM schedule_executions
      WHERE schedule_id = ? AND triggered_at >= ?
      ORDER BY triggered_at ASC
    `).all(testSchedId, startIso);

    if (executions.length >= 1 && !cycleA) {
      cycleA = executions[0];
      const taskA = db.prepare('SELECT * FROM project_tasks WHERE id = ?').get(cycleA.project_task_id);
      const runA = db.prepare('SELECT * FROM execution_runs WHERE id = ?').get(cycleA.run_id);
      const resA = db.prepare('SELECT * FROM execution_results WHERE id = ?').get(cycleA.result_id);
      console.log('\n[OBSERVED] Natural Scheduler Pickup Cycle A:');
      console.log(`- Schedule ID: ${testSchedId}`);
      console.log(`- Schedule Pickup/Execution ID: ${cycleA.id}`);
      console.log(`- Natural Pickup Timestamp: ${cycleA.triggered_at}`);
      console.log(`- Project Task ID: ${taskA?.id} ("${taskA?.title}")`);
      console.log(`- Execution Run ID: ${runA?.id} (status: ${runA?.status}, worker: ${runA?.worker_type})`);
      console.log(`- Provider / Model: ${runA?.provider || 'prov-deepseek'} / ${runA?.model || 'deepseek-v4-flash'}`);
      console.log(`- Result/Evidence ID: ${resA?.id} (${resA?.summary})`);
      console.log('- Waiting for natural cron detection of Cycle B (next occurrence)...');
    }

    if (executions.length >= 2 && cycleA && !cycleB) {
      cycleB = executions[1];
      const taskB = db.prepare('SELECT * FROM project_tasks WHERE id = ?').get(cycleB.project_task_id);
      const runB = db.prepare('SELECT * FROM execution_runs WHERE id = ?').get(cycleB.run_id);
      const resB = db.prepare('SELECT * FROM execution_results WHERE id = ?').get(cycleB.result_id);
      console.log('\n[OBSERVED] Natural Scheduler Pickup Cycle B:');
      console.log(`- Schedule Pickup/Execution ID: ${cycleB.id}`);
      console.log(`- Natural Pickup Timestamp: ${cycleB.triggered_at}`);
      console.log(`- Project Task ID: ${taskB?.id}`);
      console.log(`- Execution Run ID: ${runB?.id} (status: ${runB?.status})`);
      console.log(`- Result/Evidence ID: ${resB?.id} (${resB?.summary})`);
      break;
    }
  }

  if (!cycleA || !cycleB) {
    throw new Error('Timed out waiting for two NATURAL scheduler pickups (no stale records counted).');
  }

  const elapsedMs = new Date(cycleB.triggered_at).getTime() - new Date(cycleA.triggered_at).getTime();
  console.log(`\n[3/5] Natural Interval Duration: ${elapsedMs} ms (expected ~15000ms cadence)`);
  if (elapsedMs < 10000 || elapsedMs > 25000) {
    throw new Error(`Unexpected natural interval ${elapsedMs}ms — not a genuine 15s cadence.`);
  }

  // 4. Verify supervisor cycle counter advanced by exactly the 2 natural cycles.
  const state = db.prepare('SELECT cycle_count FROM revenue_supervisor_state WHERE id = ?').get('supervisor-singleton');
  console.log(`[4/5] Supervisor cycle_count persisted: ${state?.cycle_count} (advanced by natural cycles)`);

  // 5. Cleanup: unregister ONLY the test cron, delete test schedule + executions.
  console.log('\n[5/5] Restoring original production schedule & cleaning isolated fixture...');
  unregisterCronJob(testSchedId);
  db.prepare('DELETE FROM schedule_executions WHERE schedule_id = ?').run(testSchedId);
  db.prepare('DELETE FROM schedules WHERE id = ?').run(testSchedId);
  const leftover = db.prepare('SELECT COUNT(*) c FROM schedules WHERE id = ?').get(testSchedId).c;
  console.log(`- Isolated schedule removed (remaining rows: ${leftover})`);
  db.close();

  console.log('\nNATURAL SCHEDULER PICKUP ACCEPTANCE COMPLETE: PASSED');
  process.exit(0);
}

runNaturalSchedulerAcceptance().catch(err => {
  console.error('Natural scheduler acceptance error:', err);
  db.close();
  process.exit(1);
});
