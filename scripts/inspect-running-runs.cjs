// inspect-running-runs.cjs — read-only: columns + timestamps of running execution_runs.
const Database = require('B:/AgenticOS/server/node_modules/better-sqlite3');
const db = new Database('C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db', { readonly: true });

const cols = db.prepare('PRAGMA table_info(execution_runs)').all().map(c => c.name);
console.log('execution_runs columns:', cols.join(', '));

const rows = db.prepare("SELECT * FROM execution_runs WHERE status = 'running'").all();
for (const r of rows) {
  console.log('\n---', r.id, '---');
  for (const k of cols) {
    if (k.includes('time') || k.includes('at') || k.includes('created') || k.includes('start') || k === 'status' || k === 'trigger' || k === 'worker_type' || k === 'agent_instance_id' || k === 'provider' || k === 'model') {
      console.log(`  ${k}: ${r[k]}`);
    }
  }
}
db.close();
