// Re-poll routine-7a1b1c7f for completion + full chain in prod DB.
const API = 'http://127.0.0.1:4000/api';
const { createRequire } = await import('module');
const require = createRequire(import.meta.url);
const routineId = 'routine-7a1b1c7f-29cd-4803-9923-f5bb7b99383b';

const runs = await (await fetch(`${API}/routines/${routineId}/runs`)).json();
console.log('RUNS', JSON.stringify(runs, null, 2));

const Database = require('B:/AgenticOS/server/node_modules/better-sqlite3');
const db = new Database('C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db', { readonly: true });
const row = (q, p) => { try { return db.prepare(q).get(...p); } catch (e) { return { _err: e.message }; } };

const execRow = row('SELECT * FROM schedule_executions WHERE routine_id = ? ORDER BY triggered_at DESC LIMIT 1', [routineId]);
console.log('SCHEDULE_EXEC', JSON.stringify(execRow));
if (execRow && execRow.run_id) {
  const run = row('SELECT id, status, worker_type, task_id, goal_id, final_result_id, failure_reason FROM execution_runs WHERE id = ?', [execRow.run_id]);
  console.log('RUN', JSON.stringify(run));
  if (execRow.result_id) {
    const result = row('SELECT id, summary FROM execution_results WHERE id = ?', [execRow.result_id]);
    console.log('RESULT', JSON.stringify({ id: result.id, summary: (result.summary||'').slice(0,200) }));
  }
  if (execRow.verification_id) {
    const v = row('SELECT id, verdict FROM verifications WHERE id = ?', [execRow.verification_id]);
    console.log('VERIFICATION', JSON.stringify(v));
  }
}
const sched = row('SELECT id, last_outcome, last_error, last_triggered_at FROM schedules WHERE id = ?', ['sched-1e270f49-f8d3-4996-b5b2-0064e60db65a']);
console.log('SCHEDULE_LAST', JSON.stringify(sched));
db.close();
