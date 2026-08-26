// Read-only probe of the CANONICAL userdata DB (Roaming) — mission + branch state
import Database from 'better-sqlite3';

const p = 'C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db';
const db = new Database(p, { readonly: true });

console.log('== missions ==');
for (const m of db.prepare('SELECT id, title, status, realized_revenue, verified_revenue, pipeline_value FROM revenue_missions').all()) {
  console.log(' ', JSON.stringify(m));
}

console.log('\n== experiments for mission-616808fe- ==');
const exps = db.prepare("SELECT id, engine, status, hypothesis, actual_revenue, verified_revenue FROM revenue_experiments WHERE mission_id='mission-616808fe-' ORDER BY created_at").all();
for (const e of exps) {
  console.log(' ', e.id, e.engine, e.status, '| rev=', e.actual_revenue, '/', e.verified_revenue, '|', (e.hypothesis || '').slice(0, 60));
}
console.log('total exps for mission:', exps.length);

console.log('\n== all gates ==');
for (const g of db.prepare("SELECT id, experiment_id, gate_type, status, description FROM revenue_human_gates ORDER BY created_at").all()) {
  console.log(' ', JSON.stringify(g));
}

console.log('\n== branch state ==');
try {
  for (const b of db.prepare('SELECT * FROM revenue_branch_state').all()) {
    console.log(' ', JSON.stringify(b));
  }
} catch (e) { console.log(' (no table)', e.message); }

console.log('\n== recent action executions ==');
try {
  for (const a of db.prepare('SELECT idempotency_key, action_type, experiment_id, status, detail, created_at FROM revenue_action_executions ORDER BY created_at DESC LIMIT 15').all()) {
    console.log(' ', JSON.stringify(a));
  }
} catch (e) { console.log(' (no table)', e.message); }

console.log('\n== briefings (latest 5) ==');
try {
  for (const b of db.prepare('SELECT * FROM revenue_briefings ORDER BY created_at DESC LIMIT 5').all()) {
    console.log(' ', JSON.stringify(b).slice(0, 400));
  }
} catch (e) { console.log(' (no table)', e.message); }

console.log('\n== revenue_experiment_events recent 10 ==');
try {
  for (const ev of db.prepare("SELECT * FROM revenue_experiment_events WHERE mission_id='mission-616808fe-' ORDER BY created_at DESC LIMIT 10").all()) {
    const d = { ...ev };
    for (const k in d) if (typeof d[k] === 'string' && d[k].length > 80) d[k] = d[k].slice(0, 80) + '...';
    console.log(' ', JSON.stringify(d));
  }
} catch (e) { console.log(' (no table)', e.message); }

db.close();
