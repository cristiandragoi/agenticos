const path = require('path');
const Database = require(path.resolve('B:/AgenticOS/server/node_modules/better-sqlite3'));

const db = new Database('C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db', { readonly: true });
console.log('=== revenue_human_gates (Roaming) ===');
const gates = db.prepare('SELECT id, experiment_id, gate_type, status, branch_paused, resolved_by, resolved_at, created_at FROM revenue_human_gates ORDER BY created_at').all();
gates.forEach(g => console.log(JSON.stringify(g)));

console.log('\n=== gate status counts ===');
console.log(JSON.stringify(db.prepare('SELECT status, COUNT(*) c FROM revenue_human_gates GROUP BY status').all()));

console.log('\n=== experiments with open gates (linkage check) ===');
const exps = db.prepare('SELECT id, status FROM revenue_experiments WHERE mission_id LIKE "mission-616808fe-%"').all();
console.log('total experiments (mission-616808fe-):', exps.length);
console.log('experiment statuses:', JSON.stringify(db.prepare('SELECT status, COUNT(*) c FROM revenue_experiments WHERE mission_id LIKE "mission-616808fe-%" GROUP BY status').all()));
db.close();
