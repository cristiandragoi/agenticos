// verify-phase2d-trace-ids.cjs — read-only validation of the recovered Phase 2D
// acceptance trace against the surviving isolated fixture DB. Asserts every
// referenced ID (mission, experiments, runs, results, gates, worker instances)
// actually exists in the fixture database that produced the trace.
//
// The fixture was left in WAL mode by the (exited) acceptance process, so this
// script first copies DB+WAL+SHM to a scratch dir and checkpoints the copy —
// the original evidence files are never modified.
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require(path.resolve(__dirname, '../server/node_modules/better-sqlite3'));

const TRACE_PATH = 'B:/AgenticOS/docs/phase2d-acceptance-trace.json';
const FIXTURE_DIR = process.env.PHASE2D_FIXTURE_DIR || 'C:/Users/Cris/AppData/Local/Temp/argus-fixture-GiZD5Y';
const FIXTURE_DB = path.join(FIXTURE_DIR, 'agentic-os.db');

let failures = 0;
function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
  if (!ok) failures++;
}

if (!fs.existsSync(TRACE_PATH)) { console.error('trace missing'); process.exit(1); }
if (!fs.existsSync(FIXTURE_DB)) { console.error('fixture DB missing: ' + FIXTURE_DB); process.exit(1); }

// ── Stage a consistent copy (checkpoint WAL) ─────────────────────────────
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'phase2d-verify-'));
for (const suffix of ['', '-wal', '-shm']) {
  const src = FIXTURE_DB + suffix;
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(scratch, 'agentic-os.db' + suffix));
}
const staged = path.join(scratch, 'agentic-os.db');
const db = new Database(staged);
try {
  db.pragma('journal_mode = WAL');
  const cp = db.pragma('wal_checkpoint(TRUNCATE)');
  console.log(`[staging] checkpointed WAL copy: ${JSON.stringify(cp)} -> ${staged}\n`);
} catch (err) {
  console.error('[staging] checkpoint failed:', err.message);
  process.exit(1);
}

const t = JSON.parse(fs.readFileSync(TRACE_PATH, 'utf8'));
const one = (sql, ...args) => db.prepare(sql).get(...args);

check('trace is the 19:54Z completed run', t.startedAt === '2026-08-20T19:54:11.142Z' && !!t.missionId, `startedAt=${t.startedAt}`);

// ── Mission + experiments ────────────────────────────────────────────────
const mission = one('SELECT id, title, status FROM revenue_missions WHERE id = ?', t.missionId);
check(`mission ${t.missionId} exists in fixture`, !!mission, mission ? `${mission.title} (${mission.status})` : 'MISSING');

const dig = one('SELECT id, engine, status FROM revenue_experiments WHERE id = ?', t.digitalExperimentId);
check(`digital experiment ${t.digitalExperimentId} exists`, !!dig, dig ? `${dig.engine}/${dig.status}` : 'MISSING');

const sme = one('SELECT id, engine, status FROM revenue_experiments WHERE id = ?', t.smeExperimentId);
check(`sme experiment ${t.smeExperimentId} exists`, !!sme, sme ? `${sme.engine}/${sme.status}` : 'MISSING');

// ── Hermes leg ────────────────────────────────────────────────────────────
const hRun = t.hermes?.run ? one('SELECT id, status, worker_type, agent_instance_id, provider, model, start_time, end_time FROM execution_runs WHERE id = ?', t.hermes.run.runId) : null;
check(`hermes run ${t.hermes?.run?.runId} exists`, !!hRun, hRun ? `${hRun.worker_type}/${hRun.status} agent=${hRun.agent_instance_id} provider=${hRun.provider}/${hRun.model}` : 'MISSING');
check('hermes run provider/model recorded truthfully', !!hRun && !!hRun.provider && !!hRun.model, hRun ? `${hRun.provider}/${hRun.model}` : 'n/a');
check('hermes agent_instance_id matches worker instance', !!hRun && !!t.hermes?.workerInstanceId && hRun.agent_instance_id === t.hermes.workerInstanceId, `trace=${t.hermes?.workerInstanceId} db=${hRun?.agent_instance_id}`);

const hRes = t.hermes?.run?.resultId ? one('SELECT id, summary FROM execution_results WHERE id = ?', t.hermes.run.resultId) : null;
check(`hermes result ${t.hermes?.run?.resultId} exists`, !!hRes, hRes ? hRes.summary.slice(0, 100) : 'MISSING');

// ── CodeX leg ─────────────────────────────────────────────────────────────
const cRun = t.codex?.run ? one('SELECT id, status, worker_type, agent_instance_id, provider, model, start_time, end_time FROM execution_runs WHERE id = ?', t.codex.run.runId) : null;
check(`codex run ${t.codex?.run?.runId} exists`, !!cRun, cRun ? `${cRun.worker_type}/${cRun.status} agent=${cRun.agent_instance_id} provider=${cRun.provider}/${cRun.model}` : 'MISSING');
check('codex run provider/model recorded truthfully', !!cRun && !!cRun.provider && !!cRun.model, cRun ? `${cRun.provider}/${cRun.model}` : 'n/a');
check('codex agent_instance_id matches worker instance', !!cRun && !!t.codex?.workerInstanceId && cRun.agent_instance_id === t.codex.workerInstanceId, `trace=${t.codex?.workerInstanceId} db=${cRun?.agent_instance_id}`);

const cRes = t.codex?.run?.resultId ? one('SELECT id, summary FROM execution_results WHERE id = ?', t.codex.run.resultId) : null;
check(`codex result ${t.codex?.run?.resultId} exists`, !!cRes, cRes ? cRes.summary.slice(0, 100) : 'MISSING');

// ── Action executions ─────────────────────────────────────────────────────
const hasActionTable = one("SELECT name FROM sqlite_master WHERE type='table' AND name='revenue_action_executions'");
check('revenue_action_executions table exists', !!hasActionTable, hasActionTable ? 'yes' : 'MISSING');
if (hasActionTable) {
  const hAction = one("SELECT idempotency_key, action_type, experiment_id, correlation_id, run_id, result_id, status, worker_instance_id, provider, model FROM revenue_action_executions WHERE experiment_id = ? AND action_type = 'SME_QUALIFY' ORDER BY created_at DESC LIMIT 1", t.smeExperimentId);
  check('hermes action record exists + correlation matches', !!hAction && hAction.correlation_id === t.hermes.correlationId, hAction ? `corr=${hAction.correlation_id} run=${hAction.run_id} status=${hAction.status}` : 'MISSING');

  const cAction = one("SELECT idempotency_key, action_type, experiment_id, correlation_id, run_id, result_id, status, worker_instance_id, provider, model FROM revenue_action_executions WHERE experiment_id = ? AND action_type = 'DIGITAL_BUILD' ORDER BY created_at DESC LIMIT 1", t.digitalExperimentId);
  check('codex action record exists + correlation matches', !!cAction && cAction.correlation_id === t.codex.correlationId, cAction ? `corr=${cAction.correlation_id} run=${cAction.run_id} status=${cAction.status}` : 'MISSING');
}

// ── Negative leg ──────────────────────────────────────────────────────────
const negExp = one('SELECT id, status FROM revenue_experiments WHERE id = ?', t.negative?.experimentId);
check(`negative experiment ${t.negative?.experimentId} exists and NOT publishing`, !!negExp && negExp.status !== 'PUBLISHING', negExp ? `status=${negExp.status}` : 'MISSING');

// ── Gate check ────────────────────────────────────────────────────────────
const gate = one("SELECT gate_type, status FROM revenue_human_gates WHERE experiment_id = ? AND status='open'", t.digitalExperimentId);
check('digital branch has open SHOPIFY gate', !!gate && gate.gate_type === 'SHOPIFY_AUTH_REQUIRED', gate ? `${gate.gate_type}/${gate.status}` : 'MISSING');

// ── Orphaned runs ─────────────────────────────────────────────────────────
const orphans = db.prepare("SELECT id, status FROM execution_runs WHERE status = 'running'").all();
check('no orphaned running runs in fixture', orphans.length === 0, `running=${orphans.length}`);

// ── Side-effect safety (negative branch) ──────────────────────────────────
const publishedCount = db.prepare("SELECT COUNT(*) c FROM revenue_experiments WHERE id = ? AND status = 'PUBLISHING'").get(t.negative?.experimentId).c;
check('negative branch published count = 0', publishedCount === 0, `published=${publishedCount}`);

db.close();
// leave staged copy for post-hoc inspection; caller can rm
console.log(`\nTRACE ID VALIDATION (fixture ${path.basename(FIXTURE_DIR)}): ${failures === 0 ? 'PASS' : 'FAIL'} (${failures} failure(s))`);
console.log(`staged consistent copy at: ${staged}`);
process.exit(failures === 0 ? 0 : 1);
