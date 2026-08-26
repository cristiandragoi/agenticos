// verify-phase2d-acceptance.cjs — Phase 2D real-execution bridge acceptance.
// Isolated throwaway DB + isolated temp workspace. Never touches the real
// mission, never resolves real gates, never publishes/sends/spends.
//
// Observes the canonical revenue_action_executions table (the truthful record
// written by revenueActionExecutor) and the linked execution_runs for the real
// provider/model/agent-instance/duration evidence.

const os = require('os');
const fs = require('fs');
const path = require('path');
const Database = require(path.resolve(__dirname, '../server/node_modules/better-sqlite3'));

const dotenv = require(path.resolve(__dirname, '../server/node_modules/dotenv'));
dotenv.config({ path: path.resolve(__dirname, '../server/.env'), override: false });

const { setupIsolatedFixture } = require('./argus-fixture.cjs');

const WORKSPACE = fs.mkdtempSync(path.join(os.tmpdir(), 'agenticos-phase2d-ws-'));
process.env.AGENTICOS_WORKSPACE = WORKSPACE;

const DB_PATH = setupIsolatedFixture();
const db = new Database(DB_PATH);

const trace = {
  phase: 'phase2d-acceptance', startedAt: new Date().toISOString(),
  missionId: null, digitalExperimentId: null, smeExperimentId: null,
  hermes: null, codex: null, negative: null, orphanCheck: null, gateCheck: null, truth: null,
};

function actionRecord(actionType, experimentId) {
  const hasTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='revenue_action_executions'").get();
  if (!hasTable) return null;
  return db.prepare('SELECT * FROM revenue_action_executions WHERE action_type = ? AND experiment_id = ? ORDER BY created_at DESC LIMIT 1').get(actionType, experimentId) || null;
}

function workerRunEvidence(runId) {
  if (!runId) return null;
  const r = db.prepare('SELECT * FROM execution_runs WHERE id = ?').get(runId) || null;
  if (!r) return null;
  const res = r.final_result_id ? db.prepare('SELECT * FROM execution_results WHERE id = ?').get(r.final_result_id) : null;
  return {
    runId: r.id, status: r.status, workerType: r.worker_type, agentInstanceId: r.agent_instance_id,
    provider: r.provider, model: r.model, startTime: r.start_time, endTime: r.end_time,
    durationMs: (r.start_time && r.end_time) ? (new Date(r.end_time) - new Date(r.start_time)) : null,
    resultId: res?.id ?? null, resultSummary: res?.summary ?? null,
  };
}

async function main() {
  console.log('=== PHASE 2D REAL-EXECUTION ACCEPTANCE (ISOLATED) ===\n');
  console.log(`- Isolated DB: ${DB_PATH}\n- Isolated workspace: ${WORKSPACE}\n`);

  const ops = await import('../server/dist/services/revenueOperator/operatorService.js');
  const { revenueSupervisor } = await import('../server/dist/services/revenueOperator/revenueSupervisor.js');
  const { projectsStore } = await import('../server/dist/services/projectsStore.js');
  const { registerCronJob, unregisterCronJob } = await import('../server/dist/services/scheduler/scheduler.js');

  // ── Isolated project + mission + experiments ───────────────────────────
  const projId = 'proj-phase2d-accept';
  if (!projectsStore.getProject(projId)) {
    projectsStore.createProject({ id: projId, name: 'Phase 2D Acceptance (isolated)', workspacePath: WORKSPACE });
  }
  projectsStore.setActiveProjectId(projId);

  const mission = await ops.createMission({
    title: 'Phase 2D Acceptance (isolated)', projectId: projId, targetAmount: 300, currency: 'EUR',
    startDate: '2026-08-20', deadline: '2026-09-20', enabledEngines: ['digital_products', 'german_sme'],
  });
  trace.missionId = mission.id;

  const digital = await ops.createExperiment({
    missionId: mission.id, projectId: projId, engine: 'digital_products',
    hypothesis: 'Deterministic Phase 2D test product (spreadsheet checklist)',
    product: 'Phase2D Test Checklist', price: 19, distributionChannels: ['SHOPIFY'],
  });
  db.prepare('UPDATE revenue_experiments SET status = ? WHERE id = ?').run('APPROVED', digital.id);
  trace.digitalExperimentId = digital.id;

  const sme = await ops.createExperiment({
    missionId: mission.id, projectId: projId, engine: 'german_sme',
    hypothesis: 'Deterministic Phase 2D test SME (public profile inspect)',
    distributionChannels: ['DIRECT_OUTREACH'],
  });
  trace.smeExperimentId = sme.id;

  console.log(`[setup] mission=${mission.id}`);
  console.log(`[setup] digital(APPROVED→CodeX build)=${digital.id}`);
  console.log(`[setup] sme(DISCOVERED→Hermes inspect)=${sme.id}\n`);

  const startState = revenueSupervisor.setControlState('START', mission.id);
  console.log(`[control] Supervisor ${startState.state} on ${mission.id}\n`);

  // ── Isolated 15s schedule ──────────────────────────────────────────────
  const runToken = Date.now();
  const schedId = `schedule-phase2d-accept-${runToken}`;
  const taskId = `task-phase2d-accept-${runToken}`;
  db.prepare(`
    INSERT INTO schedules (id, task_id, type, execution_type, routine_id, worker, project_id, task_template, cron_expression, timezone, misfire_policy, enabled, created_at)
    VALUES (?, ?, 'task', 'worker_task', 'routine-revenue-supervisor', 'hermes', ?, ?, '*/15 * * * * *', 'UTC', 'skip', 1, ?)
  `).run(schedId, taskId, projId, JSON.stringify({ objective: 'Phase 2D acceptance tick', worker: 'hermes' }), new Date().toISOString());
  registerCronJob(schedId, taskId, '*/15 * * * * *', 'UTC');
  console.log(`[scheduler] ${schedId} registered (15s cron)\n`);

  // ── Observe until real workers produced terminal action records ────────
  const deadline = Date.now() + 240000;
  const startIso = new Date().toISOString();

  let hermesAction = null;
  let codexAction = null;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    const digitalRow = db.prepare('SELECT status FROM revenue_experiments WHERE id = ?').get(digital.id);
    const smeRow = db.prepare('SELECT status FROM revenue_experiments WHERE id = ?').get(sme.id);
    const digitalGate = db.prepare("SELECT COUNT(*) c FROM revenue_human_gates WHERE experiment_id = ? AND status='open'").get(digital.id).c;

    if (!codexAction) codexAction = actionRecord('DIGITAL_BUILD', digital.id);
    if (!hermesAction) hermesAction = actionRecord('SME_QUALIFY', sme.id);

    console.log(`[observe] digital=${digitalRow.status} gate=${digitalGate} | sme=${smeRow.status} | build=${codexAction ? codexAction.status : 'pending'} inspect=${hermesAction ? hermesAction.status : 'pending'}`);

    if (codexAction && codexAction.status === 'completed' && hermesAction && hermesAction.status === 'completed' && digitalGate >= 1) break;
  }

  // ── Capture truthful evidence from canonical records ───────────────────
  trace.codex = codexAction ? {
    actionType: codexAction.action_type, correlationId: codexAction.correlation_id, executor: codexAction.executor,
    provider: codexAction.provider, model: codexAction.model, runId: codexAction.run_id, resultId: codexAction.result_id,
    status: codexAction.status, detail: codexAction.detail, workerInstanceId: codexAction.worker_instance_id,
    run: workerRunEvidence(codexAction.run_id),
  } : null;

  trace.hermes = hermesAction ? {
    actionType: hermesAction.action_type, correlationId: hermesAction.correlation_id, executor: hermesAction.executor,
    provider: hermesAction.provider, model: hermesAction.model, runId: hermesAction.run_id, resultId: hermesAction.result_id,
    status: hermesAction.status, detail: hermesAction.detail, workerInstanceId: hermesAction.worker_instance_id,
    run: workerRunEvidence(hermesAction.run_id),
  } : null;

  // ── Negative: resolved gate → BLOCKED_INTEGRATION_REQUIRED (no publish) ─
  const neg = await ops.createExperiment({
    missionId: mission.id, projectId: projId, engine: 'digital_products',
    hypothesis: 'Negative block test (resolved Shopify gate)', product: 'Negative test', distributionChannels: ['SHOPIFY'],
  });
  db.prepare('UPDATE revenue_experiments SET status = ? WHERE id = ?').run('READY_TO_PUBLISH', neg.id);
  db.prepare(`INSERT INTO revenue_human_gates (id, experiment_id, gate_type, status, description, branch_paused, resolved_by, resolved_at, metadata, created_at, updated_at)
    VALUES (?, ?, 'SHOPIFY_AUTH_REQUIRED', 'resolved', 'resolved for negative test', 0, 'acceptance-test', ?, NULL, ?, ?)`)
    .run(`gate-neg-${runToken}`, neg.id, new Date().toISOString(), new Date().toISOString(), new Date().toISOString());
  console.log(`\n[negative] resolved-gate experiment ${neg.id}; next cycle must BLOCK, not publish.`);

  await new Promise((r) => setTimeout(r, 35000));
  const negBlock = db.prepare("SELECT * FROM revenue_action_executions WHERE experiment_id = ? AND action_type = 'BLOCKED_INTEGRATION_REQUIRED' ORDER BY created_at DESC LIMIT 1").get(neg.id);
  const publishedCount = db.prepare("SELECT COUNT(*) c FROM revenue_experiments WHERE id = ? AND status = 'PUBLISHING'").get(neg.id).c;
  trace.negative = {
    experimentId: neg.id, status: negBlock?.status ?? null, blockedReason: negBlock?.error ?? null,
    detail: negBlock?.detail ?? null, publishedCount,
  };

  // ── Orphan + gate checks ───────────────────────────────────────────────
  const orphanRuns = db.prepare("SELECT id, status FROM execution_runs WHERE status = 'running' AND created_at >= ?").all(startIso);
  trace.orphanCheck = { runningRuns: orphanRuns };
  const digitalGate = db.prepare("SELECT gate_type, status FROM revenue_human_gates WHERE experiment_id = ? AND status='open'").get(digital.id);
  trace.gateCheck = { digital: digitalGate || null };

  console.log('\n=== RESULTS ===');
  console.log('Hermes:', JSON.stringify(trace.hermes, null, 2));
  console.log('CodeX:', JSON.stringify(trace.codex, null, 2));
  console.log('Negative:', JSON.stringify(trace.negative, null, 2));

  const outPath = path.join(WORKSPACE, 'phase2d-acceptance-trace.json');
  fs.writeFileSync(outPath, JSON.stringify(trace, null, 2));
  // Stable evidence path for the ARGUS acceptance-evidence check.
  const stablePath = path.resolve(__dirname, '../docs/phase2d-acceptance-trace.json');
  fs.writeFileSync(stablePath, JSON.stringify(trace, null, 2));
  console.log(`\nTrace written to ${outPath}`);
  console.log(`Stable evidence written to ${stablePath}`);

  // ── Cleanup ────────────────────────────────────────────────────────────
  unregisterCronJob(schedId);
  db.prepare('DELETE FROM schedule_executions WHERE schedule_id = ?').run(schedId);
  db.prepare('DELETE FROM schedules WHERE id = ?').run(schedId);

  console.log('\n=== ACCEPTANCE SUMMARY ===');
  const hermesReal = trace.hermes && trace.hermes.run && trace.hermes.run.agentInstanceId && trace.hermes.provider;
  const codexReal = trace.codex && trace.codex.run && trace.codex.run.agentInstanceId && trace.codex.provider;
  console.log(`Hermes real execution: ${hermesReal ? `PASS (${trace.hermes.provider}/${trace.hermes.model}, ${trace.hermes.run.durationMs}ms, ${trace.hermes.run.agentInstanceId})` : 'FAIL/UNVERIFIED'}`);
  console.log(`CodeX real execution:  ${codexReal ? `PASS (${trace.codex.provider}/${trace.codex.model}, ${trace.codex.run.durationMs}ms, ${trace.codex.run.agentInstanceId})` : 'FAIL/UNVERIFIED'}`);
  console.log(`Negative publish block: ${trace.negative.status === 'blocked' ? 'PASS (BLOCKED_INTEGRATION_REQUIRED)' : 'NOT-BLOCKED'}`);
  console.log(`No orphan runs: ${orphanRuns.length === 0 ? 'PASS' : `FAIL (${orphanRuns.length})`}`);
  console.log(`Digital Shopify gate: ${digitalGate ? 'PASS' : 'MISSING'}`);
  console.log(`Negative published count: ${publishedCount} (must be 0)`);

  db.close();
  const ok = !!(hermesReal && codexReal && trace.negative.status === 'blocked' && orphanRuns.length === 0 && publishedCount === 0);
  console.log(`\nPHASE 2D ACCEPTANCE: ${ok ? 'PASS' : 'PARTIAL'}`);
  process.exit(ok ? 0 : 2);
}

main().catch((err) => { console.error('Phase 2D acceptance error:', err); try { db.close(); } catch {} process.exit(1); });
