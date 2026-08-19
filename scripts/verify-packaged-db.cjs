/* Read-only check of packaged DB: argus tables present, revenue_metrics ABSENT. */
const path = require('path');
const Database = require(path.resolve('B:/AgenticOS/server/node_modules/better-sqlite3'));
const db = new Database('C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db', { readonly: true });
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE 'argus%' OR name='revenue_metrics') ORDER BY name").all().map(r => r.name);
console.log('relevant tables:', tables.join(', '));
console.log('has revenue_metrics:', tables.includes('revenue_metrics'));
const cols = db.prepare('PRAGMA table_info(goals)').all().map(c => c.name);
console.log('goals has verification_state:', cols.includes('verification_state'), '| contract_id:', cols.includes('contract_id'));
const migs = db.prepare('SELECT id, hash, created_at FROM __drizzle_migrations ORDER BY id DESC LIMIT 3').all();
console.log('last migrations:', migs.map(m => `${m.id}:${(m.hash || '').slice(0, 8)}`).join(', '));
db.close();
