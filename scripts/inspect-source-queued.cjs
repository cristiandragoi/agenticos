// Check source DB queued goals (dev DB at B:\AgenticOS\server\data)
const path = require('path');
const Database = require(path.resolve(__dirname, '../server/node_modules/better-sqlite3'));
const db = new Database(path.resolve(__dirname, '../server/data/agentic-os.db'), { readonly: true });
const queued = db.prepare('SELECT id, status, worker_id, lease_expires_at, created_at, updated_at FROM goals WHERE status = ?').all('queued');
console.log('SOURCE QUEUED:', JSON.stringify(queued, null, 1));
const counts = db.prepare('SELECT status, count(*) c FROM goals GROUP BY status ORDER BY c DESC').all();
console.log('SOURCE COUNTS:', JSON.stringify(counts));
db.close();
