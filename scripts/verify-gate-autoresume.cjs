const path = require('path');
const Database = require(path.resolve(__dirname, '../server/node_modules/better-sqlite3'));

console.log('=== EVENT-DRIVEN HUMAN GATE AUTO-RESUMPTION VERIFIER (ISOLATED FIXTURE) ===\n');

const { setupIsolatedFixture } = require('./argus-fixture.cjs');
const DB_PATH = setupIsolatedFixture();
const db = new Database(DB_PATH);

const MISSION_ID = 'mission-616808fe-';

async function run() {
  // Register canonical adapters so the continuation dispatch resolves rt-hermes.
  const { runtimeRegistry } = await import('../server/dist/services/runtimeRegistry.js');
  const { HermesAdapter } = await import('../server/dist/adapters/hermesAdapter.js');
  const { JarvisAdapter } = await import('../server/dist/adapters/jarvisAdapter.js');
  const { CodexAdapter } = await import('../server/dist/adapters/codexAdapter.js');
  runtimeRegistry.register(new HermesAdapter());
  runtimeRegistry.register(new JarvisAdapter());
  runtimeRegistry.register(new CodexAdapter());

  // ── Isolated safe fixture (unique ids; deleted at the end) ─────────────────
  const token = Date.now();
  const testExpId = `exp-gate-fixture-${token}`;
  const testGateId = `gate-fixture-${token}`;
  const now = new Date().toISOString();

  console.log('[1/6] Creating isolated experiment + gate fixture...');
  db.prepare(`
    INSERT INTO revenue_experiments (id, mission_id, engine, hypothesis, status, created_at, updated_at)
    VALUES (?, ?, 'digital_products', 'Isolated gate auto-resumption fixture', 'BLOCKED', ?, ?)
  `).run(testExpId, MISSION_ID, now, now);

  db.prepare(`
    INSERT INTO revenue_human_gates (id, experiment_id, gate_type, status, description, branch_paused, created_at, updated_at)
    VALUES (?, ?, 'OUTBOUND_APPROVAL', 'open', 'Isolated gate fixture', 1, ?, ?)
  `).run(testGateId, testExpId, now, now);
  console.log(`- Experiment: ${testExpId}`);
  console.log(`- Gate:       ${testGateId} (status=open, branch_paused=1)`);

  // Baseline: count other (non-fixture) experiments — must remain unchanged.
  const baselineOtherExps = db.prepare('SELECT COUNT(*) c FROM revenue_experiments WHERE mission_id = ? AND id != ?').get(MISSION_ID, testExpId).c;
  console.log(`- Baseline other experiments (must remain unchanged): ${baselineOtherExps}`);

  // ── Canonical resolution (ONLY public service call) ────────────────────────
  console.log('\n[2/6] Calling canonical resolveHumanGate (the ONLY public API used)...');
  const { resolveHumanGate } = await import('../server/dist/services/revenueOperator/operatorService.js');
  const resolver = 'argus-verifier';
  const resolved = await resolveHumanGate(testGateId, resolver);
  console.log(`- resolveHumanGate returned: status=${resolved?.status}, branchPaused=${resolved?.branchPaused}`);

  // ── Strict-timeout observation of the persisted trace ─────────────────────
  console.log('\n[3/6] Observing persisted canonical records (strict timeout 10s)...');
  const deadline = Date.now() + 10000;
  let trace = null;
  while (Date.now() < deadline) {
    const gate = db.prepare('SELECT * FROM revenue_human_gates WHERE id = ?').get(testGateId);
    const exp = db.prepare('SELECT * FROM revenue_experiments WHERE id = ?').get(testExpId);
    const evt = db.prepare("SELECT * FROM revenue_experiment_events WHERE experiment_id = ? AND event_type = 'human_gate_resolved' ORDER BY created_at DESC LIMIT 1").get(testExpId);
    const task = db.prepare("SELECT * FROM tasks WHERE id LIKE ? ORDER BY created_at DESC LIMIT 1").get(`task-gate-resume-${testExpId.slice(0, 8)}%`);
    let run = null;
    if (task) run = db.prepare('SELECT * FROM runs WHERE task_id = ? ORDER BY created_at DESC LIMIT 1').get(task.id);

    if (gate?.status === 'resolved' && exp?.status === 'IN_PROGRESS' && evt && task && run && run.status === 'completed') {
      trace = { gate, exp, evt, task, run };
      break;
    }
    await new Promise(r => setTimeout(r, 250));
  }

  if (!trace) {
    // report partial state for diagnosis
    const g = db.prepare('SELECT status FROM revenue_human_gates WHERE id = ?').get(testGateId);
    const e = db.prepare('SELECT status FROM revenue_experiments WHERE id = ?').get(testExpId);
    console.error('FAILED to observe full trace. gate=', g, 'experiment=', e);
    throw new Error('Gate auto-resumption did not produce a completed run within timeout.');
  }

  const { gate, exp, evt, task, run } = trace;
  const input = safeJson(run.input);
  const metadata = safeJson(run.metadata);
  const output = safeJson(run.output);

  console.log('\n[4/6] COMPLETE EVENT-DRIVEN RESUMPTION TRACE:');
  console.log(`- Gate ID:            ${gate.id}`);
  console.log(`  Gate status:        ${gate.status} (resolved_by=${gate.resolved_by}, branch_paused=${gate.branch_paused})`);
  console.log(`- Experiment ID:      ${exp.id}`);
  console.log(`  Experiment status:  ${exp.status}`);
  console.log(`- Event ID:           ${evt.id} (event_type=${evt.event_type}, actor_type=${evt.actor_type}, actor_id=${evt.actor_id})`);
  console.log(`- Continuation Task:  ${task.id} (status=${task.status})`);
  console.log(`- Run ID:             ${run.id} (status=${run.status}, trigger=${run.trigger})`);
  console.log(`- Correlation ID:     ${metadata?.correlationId || input?.correlationId}`);
  console.log(`- Selected Executor:  ${metadata?.selectedExecutorId || input?.preferredExecutorId}`);
  console.log(`- Evidence ID:        ${metadata?.evidenceId || output?.evidenceId}`);
  console.log(`- Result/output:      ${typeof output === 'string' ? output : (output?.summary || JSON.stringify(output))}`);

  // ── Assertions ─────────────────────────────────────────────────────────────
  console.log('\n[5/6] Assertions:');
  const checks = [
    ['gate resolved', gate.status === 'resolved'],
    ['experiment IN_PROGRESS', exp.status === 'IN_PROGRESS'],
    ['human_gate_resolved event persisted', !!evt],
    ['continuation task created', !!task],
    ['run COMPLETED (not running)', run.status === 'completed'],
    ['task COMPLETED', task.status === 'completed'],
    ['result/output persisted', !!output],
    ['correlation metadata present', !!metadata?.correlationId || !!input?.correlationId],
    ['evidence metadata present', !!metadata?.evidenceId || !!output?.evidenceId],
  ];
  for (const [label, ok] of checks) {
    console.log(`- [${ok ? 'PASS' : 'FAIL'}] ${label}`);
    if (!ok) throw new Error(`Assertion failed: ${label}`);
  }

  // Other branches remain runnable / unaffected.
  const afterOtherExps = db.prepare('SELECT COUNT(*) c FROM revenue_experiments WHERE mission_id = ? AND id != ?').get(MISSION_ID, testExpId).c;
  console.log(`- [${afterOtherExps === baselineOtherExps ? 'PASS' : 'FAIL'}] Other branches unaffected (${baselineOtherExps} -> ${afterOtherExps})`);
  if (afterOtherExps !== baselineOtherExps) throw new Error('Other branches changed count.');

  // ── Cleanup ONLY the fixture ───────────────────────────────────────────────
  console.log('\n[6/6] Cleaning isolated fixture only...');
  const runId = run.id;
  const taskId = task.id;
  db.prepare('DELETE FROM runs WHERE id = ?').run(runId);
  db.prepare('DELETE FROM tasks WHERE id = ?').run(taskId);
  db.prepare('DELETE FROM revenue_experiment_events WHERE experiment_id = ?').run(testExpId);
  db.prepare('DELETE FROM revenue_human_gates WHERE id = ?').run(testGateId);
  db.prepare('DELETE FROM revenue_experiments WHERE id = ?').run(testExpId);
  const remaining = db.prepare('SELECT COUNT(*) c FROM revenue_experiments WHERE id = ?').get(testExpId).c;
  console.log(`- Fixture removed (remaining experiment rows: ${remaining})`);

  console.log('\nEVENT-DRIVEN HUMAN GATE AUTO-RESUMPTION: PASSED');
  db.close();
  process.exit(0);
}

function safeJson(v) {
  if (v == null) return null;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return null; }
}

run().catch(err => {
  console.error('Gate auto-resumption verifier error:', err);
  try { db.close(); } catch {}
  process.exit(1);
});
