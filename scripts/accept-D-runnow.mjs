// Test D — run-now uses the same canonical dispatch path, triggerType=manual.
// Also verifies no duplicate timer for a schedule-less routine.
const API = 'http://127.0.0.1:4000/api';
const { createRequire } = await import('module');
const require = createRequire(import.meta.url);

async function post(path, body) {
  const r = await fetch(`${API}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

// Create a project + a schedule-less routine.
const proj = await post('/projects', { name: `RunNow D ${Date.now()}`, tags: ['acceptance'] });
const projectId = proj.body.id;
const routine = await post('/routines', {
  projectId,
  name: 'RunNow Manual Smoke Test D',
  objective: 'State in one sentence what the number 42 is famous for in technology culture.',
  worker: 'hermes',
  // NO cronExpression → schedule-less routine.
  enabled: true,
});
console.log('ROUTINE_ID=' + routine.body.routineId);
console.log('SCHEDULE_ID=' + routine.body.scheduleId);

// run-now
const runNow = await post(`/routines/${routine.body.routineId}/run-now`, {});
console.log('RUN_NOW_RESPONSE', JSON.stringify(runNow.body));

// Poll to terminal
const deadline = Date.now() + 120000;
let runs = [];
while (Date.now() < deadline) {
  runs = await (await fetch(`${API}/routines/${routine.body.routineId}/runs`)).json();
  if (runs.length > 0 && runs.some(r => r.status !== 'dispatched')) { await new Promise(r=>setTimeout(r,6000)); runs = await (await fetch(`${API}/routines/${routine.body.routineId}/runs`)).json(); break; }
  await new Promise(r => setTimeout(r, 4000));
}
console.log('RUNS_VIEW', JSON.stringify(runs, null, 2));

// Verify DB
const Database = require('B:/AgenticOS/server/node_modules/better-sqlite3');
const db = new Database('C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db', { readonly: true });
const row = (q,p) => { try { return db.prepare(q).get(...p); } catch(e){ return {_err:e.message}; } };
const execRow = row('SELECT * FROM schedule_executions WHERE routine_id=? ORDER BY triggered_at DESC LIMIT 1', [routine.body.routineId]);
console.log('SCHEDULE_EXEC', JSON.stringify(execRow));
// Exactly one execution row for this manual trigger.
const count = row('SELECT COUNT(*) c FROM schedule_executions WHERE routine_id=?', [routine.body.routineId]).c;
console.log('EXEC_COUNT (should be 1):', count);
db.close();
