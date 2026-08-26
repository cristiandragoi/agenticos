const path = require('path');
const Database = require(path.resolve('B:/AgenticOS/server/node_modules/better-sqlite3'));

function check(label, dbPath) {
  const db = new Database(dbPath, { readonly: true });
  console.log(`\n=== ${label} ===`);
  try {
    const recent = db.prepare("SELECT id, schedule_id, outcome, triggered_at FROM schedule_executions ORDER BY triggered_at DESC LIMIT 6").all();
    console.log('-- recent schedule_executions --');
    recent.forEach(r => console.log(`  ${r.schedule_id} | ${r.outcome} | ${r.triggered_at}`));
    const cnt24h = db.prepare("SELECT COUNT(*) c FROM schedule_executions WHERE triggered_at > datetime('now','-1 day')").get().c;
    console.log('  (executions in last 24h:', cnt24h + ')');
  } catch (e) { console.log('schedule_executions err:', e.message); }

  try {
    const runs = db.prepare("SELECT id, status, trigger, created_at FROM runs ORDER BY created_at DESC LIMIT 5").all();
    console.log('-- recent runs --');
    runs.forEach(r => console.log(`  ${r.id} | ${r.status} | ${r.trigger} | ${r.created_at}`));
  } catch (e) { console.log('runs err:', e.message); }
  db.close();
}
check('DEV', 'B:/AgenticOS/server/data/agentic-os.db');
check('ROAMING', 'C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db');
