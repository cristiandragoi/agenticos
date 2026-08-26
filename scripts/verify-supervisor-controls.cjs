const path = require('path');
const Database = require(path.resolve(__dirname, '../server/node_modules/better-sqlite3'));

console.log('=== SUPERVISOR CONTROLS + RESTART RECOVERY VERIFIER ===\n');

const { setupIsolatedFixture } = require('./argus-fixture.cjs');
const DB_PATH = setupIsolatedFixture();
const db = new Database(DB_PATH);

function persistedState() {
  return db.prepare('SELECT * FROM revenue_supervisor_state WHERE id = ?').get('supervisor-singleton');
}

async function run() {
  const { RevenueMissionSupervisor } = await import('../server/dist/services/revenueOperator/revenueSupervisor.js');

  const original = persistedState();
  const originalControl = original?.control_state || 'ACTIVE';
  console.log(`- Original persisted control state before test: ${originalControl} (cycle_count=${original?.cycle_count})`);

  const sup = new RevenueMissionSupervisor();

  // ── START ──────────────────────────────────────────────────────────────────
  console.log('\n[1/6] START');
  const r1 = sup.setControlState('START', 'mission-616808fe-');
  console.log(`- setControlState('START') -> ${r1.state}`);
  const r1b = sup.setControlState('START', 'mission-616808fe-');
  console.log(`- repeated setControlState('START') -> ${r1b.state} (idempotent)`);
  let st = persistedState();
  console.log(`- persisted control_state: ${st.control_state}`);
  if (r1.state !== 'ACTIVE' || r1b.state !== 'ACTIVE' || st.control_state !== 'ACTIVE') throw new Error('START failed.');

  // ── PAUSE ─────────────────────────────────────────────────────────────────
  console.log('\n[2/6] PAUSE');
  const beforePauseCycle = persistedState().cycle_count;
  const r2 = sup.setControlState('PAUSE');
  console.log(`- setControlState('PAUSE') -> ${r2.state}`);
  const cyclePaused = await sup.runSupervisorCycle();
  const afterPauseCycle = persistedState().cycle_count;
  console.log(`- cycle attempt while PAUSED: cycle_count ${beforePauseCycle} -> ${afterPauseCycle} (blocked=${beforePauseCycle === afterPauseCycle}, status.state=${cyclePaused.controlState})`);
  if (r2.state !== 'PAUSED' || afterPauseCycle !== beforePauseCycle) throw new Error('PAUSE did not block new work.');

  // ── RESUME ────────────────────────────────────────────────────────────────
  console.log('\n[3/6] RESUME');
  const r3 = sup.setControlState('RESUME');
  console.log(`- setControlState('RESUME') -> ${r3.state}`);
  const resumeState = persistedState();
  console.log(`- persisted control_state: ${resumeState.control_state} (continues from cycle_count=${resumeState.cycle_count})`);
  if (r3.state !== 'ACTIVE' || resumeState.control_state !== 'ACTIVE') throw new Error('RESUME failed.');

  // ── STOP ──────────────────────────────────────────────────────────────────
  console.log('\n[4/6] STOP (preserve work, block scheduling)');
  const tasksBefore = db.prepare('SELECT COUNT(*) c FROM tasks').get().c;
  const runsBefore = db.prepare('SELECT COUNT(*) c FROM runs').get().c;
  const r4 = sup.setControlState('STOP');
  console.log(`- setControlState('STOP') -> ${r4.state}`);
  const cycleStopped = await sup.runSupervisorCycle();
  const tasksAfter = db.prepare('SELECT COUNT(*) c FROM tasks').get().c;
  const runsAfter = db.prepare('SELECT COUNT(*) c FROM runs').get().c;
  const stopState = persistedState();
  console.log(`- cycle attempt while STOPPED: skipped (state=${cycleStopped.controlState})`);
  console.log(`- tasks preserved: ${tasksBefore} -> ${tasksAfter} (deleted=${tasksAfter < tasksBefore})`);
  console.log(`- runs preserved:  ${runsBefore} -> ${runsAfter} (deleted=${runsAfter < runsBefore})`);
  console.log(`- persisted control_state: ${stopState.control_state}`);
  if (r4.state !== 'STOPPED' || tasksAfter < tasksBefore || runsAfter < runsBefore) throw new Error('STOP failed to preserve work / block.');

  // ── Restart recovery ──────────────────────────────────────────────────────
  console.log('\n[5/6] Restart recovery (fresh supervisor instance reads persisted state)');
  const freshSup = new RevenueMissionSupervisor();
  const freshStatus = await freshSup.getStatus();
  console.log(`- fresh instance loaded control_state: ${freshStatus.controlState} (persisted STOPPED survives restart)`);
  if (freshStatus.controlState !== 'STOPPED') throw new Error('STOP did not survive restart.');

  // A fresh instance in STOPPED must skip cycles until explicit START.
  const beforeFreshCycle = persistedState().cycle_count;
  await freshSup.runSupervisorCycle();
  const afterFreshCycle = persistedState().cycle_count;
  console.log(`- fresh STOPPED instance cycle blocked: ${beforeFreshCycle} -> ${afterFreshCycle}`);
  if (afterFreshCycle !== beforeFreshCycle) throw new Error('STOPPED fresh instance executed a cycle.');

  // ── Explicit START after STOP ─────────────────────────────────────────────
  console.log('\n[6/6] Explicit START after STOP');
  const r6 = freshSup.setControlState('START', 'mission-616808fe-');
  console.log(`- setControlState('START') -> ${r6.state} (explicit START reactivates)`);
  if (r6.state !== 'ACTIVE') throw new Error('Explicit START after STOP failed.');

  // Restore original production control state.
  console.log(`\n- Restoring original persisted control state: ${originalControl}`);
  db.prepare('UPDATE revenue_supervisor_state SET control_state = ?, updated_at = ? WHERE id = ?').run(originalControl, new Date().toISOString(), 'supervisor-singleton');
  const restored = persistedState();
  console.log(`- Restored control_state: ${restored.control_state}`);

  console.log('\nSUPERVISOR CONTROLS + RESTART RECOVERY: PASSED');
  db.close();
  process.exit(0);
}

run().catch(err => { console.error('Controls verifier error:', err); try { db.close(); } catch {} process.exit(1); });
