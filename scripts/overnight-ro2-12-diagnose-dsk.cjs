/* OVERNIGHT RO2 — diagnose Codex failure for expt-978155f7- (Datenschutz-Kit, 2 failed attempts) */
const path = require('path');
const RES = 'C:/Users/Cris/Desktop/desktop/Agentic_OS/Agentic OS/resources';
const Database = require(path.join(RES, 'server/node_modules/better-sqlite3'));
const db = new Database('C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db', { readonly: true });

for (const runId of ['er-3450bbee-7', 'er-2cf95226-0']) {
  const run = db.prepare('SELECT id, status, failure_reason, goal_id, provider, model FROM execution_runs WHERE id = ?').get(runId);
  console.log(`\n=== RUN ${runId}: ${run?.status} | failure: ${run?.failure_reason}`);
  if (run?.goal_id) {
    const goal = db.prepare('SELECT id, status FROM goals WHERE id = ?').get(run.goal_id);
    console.log('goal:', JSON.stringify(goal));
    const events = db.prepare('SELECT sequence, event_type, message, error, error_code, error_details FROM goal_events WHERE goal_id = ? ORDER BY sequence DESC LIMIT 8').all(run.goal_id);
    for (const e of events) {
      console.log(`  [${e.sequence}] ${e.event_type}: ${(e.message || '').slice(0, 150)}${e.error ? ' | ERR: ' + String(e.error).slice(0, 200) : ''}${e.error_code ? ' | code: ' + e.error_code : ''}`);
      if (e.error_details) console.log('      details:', String(e.error_details).slice(0, 250));
    }
  }
}
db.close();
