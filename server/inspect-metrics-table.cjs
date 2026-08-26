// Read-only inspection of revenue_metrics table + migration mechanism
const Database = require('better-sqlite3');
const path = require('path');
const dbPath = path.resolve(__dirname, 'data/agentic-os.db');
const db = new Database(dbPath, { readonly: true });

console.log('=== revenue_metrics table SQL ===');
const t = db.prepare("SELECT sql FROM sqlite_master WHERE name='revenue_metrics'").get();
console.log(t ? t.sql : '(NOT FOUND)');

console.log('\n=== revenue_metrics columns (PRAGMA) ===');
try {
  const cols = db.prepare("PRAGMA table_info('revenue_metrics')").all();
  cols.forEach(c => console.log(`${c.cid}\t${c.name}\t${c.type}\tnotnull=${c.notnull}\tdefault=${c.dflt_value}\tpk=${c.pk}`));
} catch (e) { console.log('ERR', e.message); }

console.log('\n=== __drizzle_migrations schema ===');
const m = db.prepare("SELECT sql FROM sqlite_master WHERE name='__drizzle_migrations'").get();
console.log(m ? m.sql : '(NOT FOUND)');

console.log('\n=== __drizzle_migrations last 3 ===');
try {
  console.log(JSON.stringify(db.prepare('SELECT id, hash, created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 3').all(), null, 1));
} catch (e) { console.log('ERR', e.message); }

console.log('\n=== revenue_metrics row count ===');
try {
  console.log(db.prepare('SELECT COUNT(*) AS n FROM revenue_metrics').get());
} catch (e) { console.log('ERR', e.message); }

db.close();
