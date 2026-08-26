// Inspect dev DB migration state (read-only)
const Database = require('better-sqlite3');
const path = require('path');
const dbPath = path.resolve(__dirname, 'data/agentic-os.db');
const db = new Database(dbPath, { readonly: true });
console.log('DB:', dbPath);
try {
  const rows = db.prepare('SELECT id, hash, created_at FROM __drizzle_migrations ORDER BY id DESC LIMIT 8').all();
  console.log('__drizzle_migrations (last 8):', JSON.stringify(rows, null, 1));
} catch (e) { console.log('MIGR_TABLE_ERR', e.message); }
try {
  const t = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'revenue%'").all();
  console.log('revenue tables:', JSON.stringify(t));
} catch (e) { console.log('ERR2', e.message); }
db.close();
