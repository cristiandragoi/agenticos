const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function sha256(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const buffer = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function getFileInfo(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const stat = fs.statSync(filePath);
  return {
    path: path.resolve(filePath),
    sizeBytes: stat.size,
    mtime: stat.mtime.toISOString(),
    sha256: sha256(filePath)
  };
}

console.log('=== 1. DATABASE FILES ===');
const dbs = [
  'server/data/agentic-os.db',
  'server/data/agentic-os.db-wal',
  'server/data/agentic-os.db-shm',
  'server/data/agentic-os.backup-1785501527654.db',
  'backups/checkpoint-conversational-supervisor-20260821-180908/agentic-os.db',
  'docs/backups/phase2d-2026-08-20T20-06-17/agentic-os.roaming-snapshot.db',
  path.join(process.env.APPDATA || '', 'agenticos/data/agentic-os.db'),
  path.join(process.env.LOCALAPPDATA || '', 'Programs/AgenticOS/resources/server/data/agentic-os.db'),
];

for (const d of dbs) {
  const info = getFileInfo(d);
  if (info) console.log(JSON.stringify(info, null, 2));
}

console.log('\n=== 7. ORPHAN RECORD AUDIT (READ ONLY) ===');
const dbPath = path.resolve('server/data/agentic-os.db');
const db = new Database(dbPath, { readonly: true });

// Goal events orphans
const goalEventsOrphans = db.prepare(`
  SELECT ge.* FROM goal_events ge
  LEFT JOIN goals g ON ge.goal_id = g.id
  WHERE g.id IS NULL
`).all();
console.log('Orphan goal_events count:', goalEventsOrphans.length);

// Goal steps orphans
const goalStepsOrphans = db.prepare(`
  SELECT gs.* FROM goal_steps gs
  LEFT JOIN goals g ON gs.goal_id = g.id
  WHERE g.id IS NULL
`).all();
console.log('Orphan goal_steps count:', goalStepsOrphans.length);

// Background task events orphans
const bgEventsOrphans = db.prepare(`
  SELECT bte.* FROM background_task_events bte
  LEFT JOIN background_tasks bt ON bte.task_id = bt.task_id
  WHERE bt.task_id IS NULL
`).all();
console.log('Orphan background_task_events count:', bgEventsOrphans.length);

// Current row counts
console.log('\n=== CURRENT ROW COUNTS ===');
const tables = ['goals', 'goal_events', 'goal_steps', 'background_tasks', 'background_task_events', 'tasks', 'runs', 'conversations', 'conversation_messages'];
for (const t of tables) {
  try {
    const c = db.prepare(`SELECT count(*) as count FROM ${t}`).get();
    console.log(`${t}: ${c.count}`);
  } catch (e) {
    console.log(`${t}: table error (${e.message})`);
  }
}
