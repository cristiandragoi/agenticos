/* OVERNIGHT RO2 — find the Codex goal behind the failed Datenschutz-Kit runs */
const path = require('path');
const RES = 'C:/Users/Cris/Desktop/desktop/Agentic_OS/Agentic OS/resources';
const Database = require(path.join(RES, 'server/node_modules/better-sqlite3'));
const db = new Database('C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db', { readonly: true });

for (const runId of ['er-3450bbee-7', 'er-2cf95226-0']) {
  const run = db.prepare('SELECT id, status, failure_reason, agent_instance_id, metadata FROM execution_runs WHERE id = ?').get(runId);
  console.log(`\n=== RUN ${runId}`);
  console.log('agent_instance_id:', run?.agent_instance_id);
  console.log('metadata:', String(run?.metadata || '').slice(0, 300));
  const codexGoalId = run?.agent_instance_id;
  if (codexGoalId) {
    const goal = db.prepare('SELECT id, status, verification_state FROM goals WHERE id = ?').get(codexGoalId);
    console.log('codex goal:', JSON.stringify(goal));
    const events = db.prepare("SELECT sequence, event_type, message, error, error_code FROM goal_events WHERE goal_id = ? ORDER BY sequence DESC LIMIT 6").all(codexGoalId);
    for (const e of events) {
      console.log(`  [${e.sequence}] ${e.event_type}: ${(e.message || '').slice(0, 200)}${e.error ? ' | ERR: ' + String(e.error).slice(0, 250) : ''}${e.error_code ? ' | ' + e.error_code : ''}`);
    }
  }
}
db.close();
