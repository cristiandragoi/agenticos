// cleanup-orphans.cjs — truthfully mark STALE orphaned 'running' execution_runs
// as 'failed'. Only touches pre-restart Hermes runs that can never complete
// (provider=null, end_time=null, created days ago). Never touches gates/supervisor.
const Database = require('B:/AgenticOS/server/node_modules/better-sqlite3');
const db = new Database('C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db');

// Narrow, deterministic target: hermes runs stuck 'running' with no provider and
// no end_time, created before today's restart window.
const rows = db.prepare(
  "SELECT id, worker_type, created_at FROM execution_runs WHERE status = 'running' AND provider IS NULL AND end_time IS NULL"
).all();

const now = new Date().toISOString();
let cleaned = 0;
for (const r of rows) {
  // Only hermes research orphans (the 5 confirmed). Guard against touching
  // anything codex/other or recent.
  if (r.worker_type !== 'hermes') continue;
  const created = new Date(r.created_at).getTime();
  if (Date.now() - created < 60 * 60 * 1000) continue; // skip anything < 1h old
  db.prepare(
    "UPDATE execution_runs SET status = 'failed', failure_reason = ?, end_time = ?, updated_at = ? WHERE id = ?"
  ).run('Orphaned: stale running run (worker never completed; superseded by backend restart)', now, now, r.id);
  console.log('cleaned', r.id, 'worker=', r.worker_type, 'created=', r.created_at);
  cleaned++;
}

db.close();
console.log(`\n=== ORPHAN CLEANUP: ${cleaned} run(s) marked failed ===`);
process.exit(0);
