// Test I — Failure truth. Magnitude routine with a deterministically-invalid
// URL objective → real worker failure → schedule stays enabled, no synthetic PASS.
const API = 'http://127.0.0.1:4000/api';
const { createRequire } = await import('module');
const require = createRequire(import.meta.url);

async function post(path, body) {
  const r = await fetch(`${API}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

const proj = await post('/projects', { name: `Failure I ${Date.now()}`, tags: ['acceptance'] });
const projectId = proj.body.id;
const routine = await post('/routines', {
  projectId,
  name: 'Failure Truth Smoke Test I',
  objective: 'return the page title',   // no URL → deterministic URL validation failure
  worker: 'magnitude',
  cronExpression: '* * * * *',
  enabled: true,
});
console.log('ROUTINE_ID=' + routine.body.routineId);
console.log('SCHEDULE_ID=' + routine.body.scheduleId);

// Wait for natural fire + failure
const deadline = Date.now() + 150000;
let runs = [];
while (Date.now() < deadline) {
  runs = await (await fetch(`${API}/routines/${routine.body.routineId}/runs`)).json();
  if (runs.length > 0 && runs.some(r => r.status === 'execution_failed' || r.status === 'failed')) { await new Promise(r=>setTimeout(r,4000)); runs = await (await fetch(`${API}/routines/${routine.body.routineId}/runs`)).json(); break; }
  await new Promise(r => setTimeout(r, 5000));
}
console.log('RUNS_VIEW', JSON.stringify(runs, null, 2));

const Database = require('B:/AgenticOS/server/node_modules/better-sqlite3');
const db = new Database('C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db', { readonly: true });
const row = (q,p) => { try { return db.prepare(q).get(...p); } catch(e){ return {_err:e.message}; } };
const execRow = row('SELECT * FROM schedule_executions WHERE routine_id=? ORDER BY triggered_at DESC LIMIT 1', [routine.body.routineId]);
console.log('SCHEDULE_EXEC', JSON.stringify(execRow));
const sched = row('SELECT enabled,last_outcome,last_error,last_triggered_at FROM schedules WHERE id=?', [routine.body.scheduleId]);
console.log('SCHEDULE_STATE (enabled must stay 1)', JSON.stringify(sched));
const routineRow = row('SELECT enabled FROM routines WHERE routine_id=?', [routine.body.routineId]);
console.log('ROUTINE_STATE (enabled must stay 1)', JSON.stringify(routineRow));
if (execRow.run_id) {
  const run = row('SELECT status,failure_reason FROM execution_runs WHERE id=?', [execRow.run_id]);
  console.log('RUN (real worker failure)', JSON.stringify(run));
}
db.close();
