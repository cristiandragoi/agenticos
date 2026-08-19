const path = require('path');
const Database = require(path.resolve('B:/AgenticOS/server/node_modules/better-sqlite3'));
const db = new Database('B:/AgenticOS/server/data/agentic-os.db', { readonly: true });
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r => r.name);
console.log('TABLES:', tables.join(', '));
console.log('has argus_contracts:', tables.includes('argus_contracts'));
console.log('has revenue_metrics:', tables.includes('revenue_metrics'));
const hasMigrations = tables.includes('__drizzle_migrations');
if (hasMigrations) {
  const rows = db.prepare('SELECT id, hash, created_at FROM __drizzle_migrations ORDER BY id').all();
  console.log('drizzle migrations applied:', rows.map(r => r.id + ':' + (r.hash || '').slice(0, 8)).join(', '));
}
const goalCols = db.prepare("PRAGMA table_info(goals)").all().map(c => c.name);
console.log('goals columns:', goalCols.join(', '));
console.log('has verification_state:', goalCols.includes('verification_state'));
console.log('has contract_id:', goalCols.includes('contract_id'));
db.close();
