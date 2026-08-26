const path = require('path');
const Database = require(path.resolve('B:/AgenticOS/server/node_modules/better-sqlite3'));

const ROAMING = 'C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db';
const db = new Database(ROAMING, { readonly: true });

const now = new Date();
console.log('OBSERVATION TIME (local):', now.toString());
console.log('OBSERVATION TIME (ISO)  :', now.toISOString());

const rows = db.prepare(
  "SELECT schedule_id, outcome, triggered_at FROM schedule_executions WHERE schedule_id = 'schedule-revenue-supervisor-tick' ORDER BY triggered_at DESC LIMIT 12"
).all();

console.log('\nLatest supervisor-tick executions (most recent first):');
rows.forEach(r => console.log(`  ${r.triggered_at}  ${r.outcome}  (${r.schedule_id})`));

const total = db.prepare(
  "SELECT COUNT(*) c FROM schedule_executions WHERE schedule_id = 'schedule-revenue-supervisor-tick'"
).get().c;
console.log(`\nTOTAL supervisor-tick executions so far: ${total}`);

// Also count executions grouped by minute (to detect >1 pickup per minute = parallel firing)
const perMinute = db.prepare(
  "SELECT substr(triggered_at, 1, 16) AS minute, COUNT(*) c FROM schedule_executions WHERE schedule_id = 'schedule-revenue-supervisor-tick' GROUP BY minute ORDER BY minute DESC LIMIT 8"
).all();
console.log('\nExecutions grouped by minute (parallel-fire detection):');
perMinute.forEach(r => console.log(`  ${r.minute}  x${r.c}`));

db.close();
