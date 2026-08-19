// Sweep provably-abandoned QUEUED goals in the LIVE AppData DB.
// Semantics identical to goalStore.sweepStaleQueuedGoals(): status='queued',
// worker_id IS NULL, lease_expires_at IS NULL, no goal_events, stale by 30min.
// Backs up the DB file first. Non-destructive to anything else.
const path = require('path');
const fs = require('fs');
const Database = require(path.resolve(__dirname, '../server/node_modules/better-sqlite3'));

const dbPath = 'C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db';
const backupPath = `${dbPath}.backup-stale-sweep-${new Date().toISOString().replace(/[:.]/g, '-')}`;

// 1. Backup (copy file; WAL DB — copy main file; safest for a read-mostly snapshot)
fs.copyFileSync(dbPath, backupPath);
console.log('BACKUP:', backupPath);

const db = new Database(dbPath, { timeout: 15000 });

const now = Date.now();
const cutoff = new Date(now - 30 * 60 * 1000).toISOString();
const epochCutoff = String(now - 30 * 60 * 1000);

const stale = db.prepare(`
  SELECT id FROM goals
  WHERE status = 'queued'
    AND worker_id IS NULL
    AND lease_expires_at IS NULL
    AND (updated_at < ? OR updated_at < ?)
`).all(cutoff, epochCutoff);

console.log('STALE CANDIDATES:', JSON.stringify(stale));

let swept = 0;
for (const g of stale) {
  const ev = db.prepare('SELECT COUNT(*) c FROM goal_events WHERE goal_id = ?').get(g.id);
  if (ev.c > 0) {
    console.log(`SKIP ${g.id} (has events)`);
    continue;
  }
  const message = 'Goal remained QUEUED without any worker lease or execution events for over 30 minutes — provably abandoned. Marking failed; start a new task to continue.';
  db.prepare('UPDATE goals SET status = ?, updated_at = ?, worker_id = NULL, lease_expires_at = NULL WHERE id = ?')
    .run('failed', String(now), g.id);
  const seq = db.prepare('SELECT COALESCE(MAX(sequence), 0) m FROM goal_events WHERE goal_id = ?').get(g.id).m + 1;
  db.prepare(`
    INSERT INTO goal_events (id, goal_id, sequence, timestamp, state, step, message, event_type, normalized_status, lifecycle_state, user_message, technical_message, provider, model)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    `bgevt-stale-${g.id}-${now}`, g.id, seq, new Date(now).toISOString(),
    'failed', 0, message, 'task_failed', 'failed', 'failed', message, message, 'agentic-os', 'goal-stale-sweep'
  );
  console.log(`SWEPT ${g.id} -> failed`);
  swept++;
}

console.log('TOTAL SWEPT:', swept);

// Verify
const verify = db.prepare('SELECT id, status, worker_id, lease_expires_at FROM goals WHERE id IN (?, ?)').all('goal-b6c255ab', 'goal-12614066');
console.log('VERIFY:', JSON.stringify(verify, null, 1));
const counts = db.prepare('SELECT status, count(*) c FROM goals GROUP BY status ORDER BY c DESC').all();
console.log('STATUS COUNTS:', JSON.stringify(counts));

db.close();
