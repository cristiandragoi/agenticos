// Test B — Scheduled Magnitude real execution (valid URL → browser launch → title).
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const API = 'http://127.0.0.1:4000/api';

async function post(path, body) {
  const r = await fetch(`${API}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

// Check playwright resolution in the packaged server context first.
try {
  const pw = require('C:/Users/Cris/Desktop/desktop/Agentic_OS/Agentic OS/resources/server/node_modules/playwright');
  console.log('PLAYWRIGHT_RESOLVES=true version=' + (pw.chromium ? 'chromium-api-present' : 'unknown'));
} catch (e) {
  console.log('PLAYWRIGHT_RESOLVES=false ' + e.message);
}

const proj = await post('/projects', { name: `Magnitude B ${Date.now()}`, tags: ['acceptance'] });
const projectId = proj.body.id;
const routine = await post('/routines', {
  projectId,
  name: 'Magnitude Scheduled Smoke Test B',
  objective: 'Open https://example.com and return the page title.',
  worker: 'magnitude',
  enabled: true,
});
console.log('ROUTINE_ID=' + routine.body.routineId);

// run-now for a bounded single occurrence (same dispatch path; Test B wants a
// real magnitude execution — trigger type does not change the worker path).
const rn = await post(`/routines/${routine.body.routineId}/run-now`, {});
console.log('RUN_NOW', JSON.stringify(rn.body));

const deadline = Date.now() + 120000;
let runs = [];
while (Date.now() < deadline) {
  runs = await (await fetch(`${API}/routines/${routine.body.routineId}/runs`)).json();
  if (runs.length > 0 && runs.some(r => ['completed','execution_failed','failed','dispatch_failed'].includes(r.status))) { await new Promise(r=>setTimeout(r,5000)); runs = await (await fetch(`${API}/routines/${routine.body.routineId}/runs`)).json(); break; }
  await new Promise(r => setTimeout(r, 4000));
}
console.log('RUNS_VIEW', JSON.stringify(runs, null, 2));

const Database = require('B:/AgenticOS/server/node_modules/better-sqlite3');
const db = new Database('C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db', { readonly: true });
const row = (q,p) => { try { return db.prepare(q).get(...p); } catch(e){ return {_err:e.message}; } };
const execRow = row('SELECT * FROM schedule_executions WHERE routine_id=? ORDER BY triggered_at DESC LIMIT 1', [routine.body.routineId]);
console.log('SCHEDULE_EXEC', JSON.stringify(execRow));
if (execRow.run_id) {
  const run = row('SELECT status,worker_type,failure_reason FROM execution_runs WHERE id=?', [execRow.run_id]);
  console.log('RUN', JSON.stringify(run));
  if (execRow.result_id) {
    const result = row('SELECT summary,structured_output FROM execution_results WHERE id=?', [execRow.result_id]);
    let title = null;
    try { title = JSON.parse(result.structured_output || '{}').title; } catch {}
    console.log('RESULT_TITLE', title, 'SUMMARY', (result.summary||'').slice(0,120));
  }
}
db.close();
