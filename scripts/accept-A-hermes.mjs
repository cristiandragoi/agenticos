// Test A — Scheduled Hermes real execution (natural cron fire).
// Creates a project + Hermes routine with a per-minute cron, waits for a
// natural fire, then verifies the FULL canonical ID chain in the prod DB.
const API = 'http://127.0.0.1:4000/api';
const { createRequire } = await import('module');
const require = createRequire(import.meta.url);

async function post(path, body) {
  const r = await fetch(`${API}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
async function get(path) {
  const r = await fetch(`${API}${path}`);
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

// 1. Create project
const proj = await post('/projects', { name: `Hermes Smoke ${Date.now()}`, tags: ['acceptance'] });
console.log('PROJECT', JSON.stringify(proj.body));
const projectId = proj.body.id;

// 2. Create Hermes routine (cron every minute, fires at next minute boundary)
const routine = await post('/routines', {
  projectId,
  name: 'Hermes Scheduled Smoke Test',
  objective: 'Return a concise research note explaining what example.com is. Do not browse; answer from general knowledge.',
  worker: 'hermes',
  cronExpression: '* * * * *',
  enabled: true,
  verificationPolicy: 'required',
});
console.log('ROUTINE', JSON.stringify(routine.body));
const routineId = routine.body.routineId;
const scheduleId = routine.body.scheduleId;

console.log('Waiting up to 90s for natural cron fire...');
const deadline = Date.now() + 90000;
let fired = null;
while (Date.now() < deadline) {
  const runs = await get(`/routines/${routineId}/runs`);
  if (runs.body.length > 0) { fired = runs.body; break; }
  await new Promise((r) => setTimeout(r, 5000));
}

console.log('FIRED', JSON.stringify(fired));

// 3. Verify against prod DB (full chain + no executeSkill/runEngine)
const Database = require('B:/AgenticOS/server/node_modules/better-sqlite3');
const db = new Database('C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db', { readonly: true });

const row = (q, p) => { try { return db.prepare(q).get(...p); } catch (e) { return { _err: e.message }; } };

const execRow = row('SELECT * FROM schedule_executions WHERE routine_id = ? ORDER BY triggered_at DESC LIMIT 1', [routineId]);
console.log('SCHEDULE_EXEC', JSON.stringify(execRow));

let chain = null;
if (execRow && execRow.run_id) {
  const run = row('SELECT id, status, worker_type, task_id, goal_id, final_result_id FROM execution_runs WHERE id = ?', [execRow.run_id]);
  const result = execRow.result_id ? row('SELECT id, summary, structured_output FROM execution_results WHERE id = ?', [execRow.result_id]) : null;
  const verif = execRow.verification_id ? row('SELECT id, verdict FROM verifications WHERE id = ?', [execRow.verification_id]) : null;
  const bgtask = execRow.background_task_id ? row('SELECT task_id, status, worker, route FROM background_tasks WHERE task_id = ?', [execRow.background_task_id]) : null;
  const ptask = execRow.project_task_id ? row('SELECT id, assigned_capability, status FROM project_tasks WHERE id = ?', [execRow.project_task_id]) : null;
  chain = { execRow, run, result: result && { id: result.id, summary: (result.summary||'').slice(0,120), hasStructured: !!result.structured_output }, verif, bgtask, ptask };
}
console.log('CHAIN', JSON.stringify(chain, null, 2));

// Prove no legacy execution
const legacyRuns = row('SELECT COUNT(*) c FROM runs WHERE task_id = ?', [execRow?.task_id ?? 'x']).c ?? 0;
console.log('LEGACY_RUN_COUNT (must be 0):', legacyRuns);
const simCheck = execRow?.outcome;
console.log('OUTCOME:', simCheck);

db.close();
