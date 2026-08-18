// Test A — poll the routine to terminal completion and dump the full chain.
const API = 'http://127.0.0.1:4000/api';
const { createRequire } = await import('module');
const require = createRequire(import.meta.url);
const routineId = 'routine-0e801e18-0dce-4548-8d51-9e8db28c98cd';

async function get(path) { const r = await fetch(`${API}${path}`); return await r.json().catch(() => ({})); }

// Wait up to 180s for a terminal outcome (completed / failed / cancelled).
const deadline = Date.now() + 180000;
let runs = [];
while (Date.now() < deadline) {
  runs = await get(`/routines/${routineId}/runs`);
  const terminal = runs.find(r => ['completed','execution_failed','dispatch_failed','cancelled'].includes(r.status) || r.runId);
  if (runs.length > 0 && runs.some(r => r.runId || r.status !== 'dispatched')) {
    // give it a moment to fully finalize (verification + promotion)
    await new Promise(r => setTimeout(r, 8000));
    runs = await get(`/routines/${routineId}/runs`);
    break;
  }
  await new Promise(r => setTimeout(r, 5000));
}
console.log('RUNS_VIEW', JSON.stringify(runs, null, 2));

// Full chain from prod DB
const Database = require('B:/AgenticOS/server/node_modules/better-sqlite3');
const db = new Database('C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db', { readonly: true });
const row = (q, p) => { try { return db.prepare(q).get(...p); } catch (e) { return { _err: e.message }; } };
const execRow = row('SELECT * FROM schedule_executions WHERE routine_id = ? ORDER BY triggered_at DESC LIMIT 1', [routineId]);
console.log('SCHEDULE_EXEC', JSON.stringify(execRow));
if (execRow && execRow.run_id) {
  const run = row('SELECT id,status,worker_type,task_id,goal_id,final_result_id,failure_reason FROM execution_runs WHERE id=?', [execRow.run_id]);
  console.log('RUN', JSON.stringify(run));
  if (execRow.result_id) {
    const result = row('SELECT id,summary FROM execution_results WHERE id=?', [execRow.result_id]);
    console.log('RESULT', JSON.stringify({ id: result?.id, summary: (result?.summary||'').slice(0,180) }));
  }
  if (execRow.verification_id) {
    const v = row('SELECT id,verdict FROM verifications WHERE id=?', [execRow.verification_id]);
    console.log('VERIFICATION', JSON.stringify(v));
  }
  if (execRow.background_task_id) {
    const bt = row('SELECT task_id,status,worker,route FROM background_tasks WHERE task_id=?', [execRow.background_task_id]);
    console.log('BACKGROUND_TASK', JSON.stringify(bt));
  }
  if (execRow.project_task_id) {
    const pt = row('SELECT id,assigned_capability,status FROM project_tasks WHERE id=?', [execRow.project_task_id]);
    console.log('PROJECT_TASK', JSON.stringify(pt));
  }
}
const sched = row('SELECT last_outcome,last_error,last_triggered_at FROM schedules WHERE id=?', ['sched-caac5add-984d-4e3c-85e1-e1301e52fde3']);
console.log('SCHEDULE_LAST', JSON.stringify(sched));
// Prove no legacy runEngine path
const legacy = row('SELECT COUNT(*) c FROM runs WHERE trigger=?', ['schedule']).c ?? -1;
console.log('LEGACY_RUNS_TRIGGER_SCHEDULE (should be 0):', legacy);
db.close();
