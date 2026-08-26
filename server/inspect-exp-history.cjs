const path = require('path');
const Database = require(path.resolve('B:/AgenticOS/server/node_modules/better-sqlite3'));

const db = new Database('C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db', { readonly: true });

const exps = ['expt-a2598507-', 'expt-70839c88-', 'expt-fe395ce1-', 'expt-15990784-', 'expt-196b4b22-'];

console.log('=== 5 affected experiments (current) ===');
for (const id of exps) {
  const e = db.prepare('SELECT id, engine, status, product, target_customer, hypothesis FROM revenue_experiments WHERE id = ?').get(id);
  console.log(JSON.stringify(e));
}

console.log('\n=== event history per experiment (to reconstruct pre-resolution status) ===');
for (const id of exps) {
  console.log(`\n--- ${id} ---`);
  const evts = db.prepare('SELECT event_type, previous_status, next_status, actor_type, actor_id, created_at FROM revenue_experiment_events WHERE experiment_id = ? ORDER BY created_at').all(id);
  evts.forEach(ev => console.log(`  ${ev.created_at}  ${ev.event_type}  ${ev.previous_status||'-'} -> ${ev.next_status||'-'}  (${ev.actor_type}:${ev.actor_id})`));
}

console.log('\n=== current experiment status counts (mission-616808fe-) ===');
console.log(JSON.stringify(db.prepare("SELECT status, COUNT(*) c FROM revenue_experiments WHERE mission_id='mission-616808fe-' GROUP BY status").all()));

db.close();
