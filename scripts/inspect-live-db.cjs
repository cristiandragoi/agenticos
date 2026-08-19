// Read-only inspection of the LIVE AppData DB
const path = require('path');
const Database = require(path.resolve(__dirname, '../server/node_modules/better-sqlite3'));

const dbPath = 'C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db';
const db = new Database(dbPath, { readonly: true });

const rows = db.prepare('SELECT id, status, worker_id, lease_expires_at, created_at, updated_at, original_goal FROM goals WHERE id IN (?, ?, ?)').all('goal-b6c255ab', 'goal-927cd64c-', 'goal-1cedcbbd-');
console.log('=== TARGET GOALS ===');
console.log(JSON.stringify(rows.map(r => ({ ...r, original_goal: (r.original_goal || '').slice(0, 80) })), null, 2));

const count = db.prepare('SELECT status, count(*) c FROM goals GROUP BY status ORDER BY c DESC').all();
console.log('STATUS COUNTS:', JSON.stringify(count));

const asn = db.prepare('SELECT agent_id, provider_id, model_id, routing_mode, enabled, updated_at FROM agent_provider_assignments').all();
console.log('ASSIGNMENTS:', JSON.stringify(asn, null, 1));

db.close();
