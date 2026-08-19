// Read-only inspection of DEPLOYED goal rows (lease fields, status counts)
const path = require('path');
const Database = require(path.resolve(__dirname, '../server/node_modules/better-sqlite3'));

const deployedDb = 'C:/Users/Cris/Desktop/desktop/Agentic_OS/Agentic OS/resources/server/data/agentic-os.db';
console.log('=== DEPLOYED DB:', deployedDb, '===');
try {
  const db = new Database(deployedDb, { readonly: true });
  const rows = db.prepare('SELECT id, status, worker_id, lease_expires_at, created_at, updated_at, original_goal FROM goals WHERE id IN (?, ?, ?)').all('goal-b6c255ab', 'goal-927cd64c-', 'goal-1cedcbbd-');
  console.log(JSON.stringify(rows.map(r => ({ ...r, original_goal: (r.original_goal || '').slice(0, 60) })), null, 2));
  const count = db.prepare('SELECT status, count(*) c FROM goals GROUP BY status ORDER BY c DESC').all();
  console.log('STATUS COUNTS:', JSON.stringify(count));
  // assignments
  const asn = db.prepare('SELECT agent_id, provider_id, model_id, routing_mode, enabled FROM agent_provider_assignments').all();
  console.log('ASSIGNMENTS:', JSON.stringify(asn));
  db.close();
} catch (e) {
  console.log('ERR opening deployed DB:', e.message);
}
