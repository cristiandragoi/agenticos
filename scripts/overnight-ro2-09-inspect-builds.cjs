/* OVERNIGHT RO2 — investigate build outputs: what did Codex actually produce? */
const path = require('path');
const FS = require('fs');
const RES = 'C:/Users/Cris/Desktop/desktop/Agentic_OS/Agentic OS/resources';
const Database = require(path.join(RES, 'server/node_modules/better-sqlite3'));
const db = new Database('C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db', { readonly: true });

const RUNS = ['er-5f15a533-7', 'er-3450bbee-7', 'er-c6f47477-d'];
for (const runId of RUNS) {
  const run = db.prepare('SELECT id, status, failure_reason, worker_type, provider, model, goal_id FROM execution_runs WHERE id = ?').get(runId);
  const results = db.prepare('SELECT id, status, summary, structured_output, artifact_refs FROM execution_results WHERE run_id = ?').all(runId);
  console.log(`\n========== RUN ${runId}`);
  console.log('run:', run?.status, '| worker:', run?.worker_type, '| goal:', run?.goal_id, '| failure:', run?.failure_reason);
  for (const r of results) {
    console.log(`  RESULT ${r.status}: summary=${(r.summary || '').slice(0, 300)}`);
    console.log(`  artifacts: ${r.artifact_refs}`);
    const so = r.structured_output ? JSON.parse(r.structured_output) : null;
    if (so) console.log(`  structured keys: ${Object.keys(so).join(',')}`);
    if (so?.findings) console.log(`  findings: ${JSON.stringify(so.findings).slice(0, 400)}`);
  }
  // goal state
  if (run?.goal_id) {
    const goal = db.prepare('SELECT id, status, verification_state, run_summary FROM goals WHERE id = ?').get(run.goal_id);
    console.log('  goal:', goal?.status, '| verification:', goal?.verification_state);
    if (goal?.run_summary) console.log('  run_summary:', String(goal.run_summary).slice(0, 400));
    const events = db.prepare('SELECT event_type, message, error FROM goal_events WHERE goal_id = ? ORDER BY sequence DESC LIMIT 5').all(run.goal_id);
    for (const e of events) console.log(`  EVENT ${e.event_type}: ${(e.message || '').slice(0, 160)} ${e.error ? 'ERR: ' + e.error.slice(0, 120) : ''}`);
  }
}
db.close();
