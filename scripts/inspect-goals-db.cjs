// Read-only inspection of goal rows (lease fields, status counts)
const path = require('path');
const Database = require(path.resolve(__dirname, '../server/node_modules/better-sqlite3'));

for (const dbPath of [path.resolve(__dirname, '../server/data/agentic-os.db')]) {
  console.log('=== DB:', dbPath, '===');
  const db = new Database(dbPath, { readonly: true });
  const rows = db.prepare('SELECT id, status, worker_id, lease_expires_at, created_at, updated_at FROM goals WHERE id IN (?, ?, ?)').all('goal-b6c255ab', 'goal-927cd64c-', 'goal-1cedcbbd-');
  console.log(JSON.stringify(rows, null, 2));
  const count = db.prepare('SELECT status, count(*) c FROM goals GROUP BY status ORDER BY c DESC').all();
  console.log('STATUS COUNTS:', JSON.stringify(count));
  db.close();
}
