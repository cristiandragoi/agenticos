// Apply migration 0021 (revenue_metrics) to the DEV DB only, after backup.
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const dbPath = path.resolve(__dirname, 'data/agentic-os.db');
const sqlPath = path.resolve(__dirname, 'drizzle/0021_add_revenue_metrics.sql');
const backupPath = dbPath + '.backup-0021-' + new Date().toISOString().replace(/[:.]/g, '-');

fs.copyFileSync(dbPath, backupPath);
console.log('Backup:', backupPath);

const sql = fs.readFileSync(sqlPath, 'utf-8');
const statements = sql.split('--> statement-breakpoint').map((s) => s.trim()).filter(Boolean);

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
const existing = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='revenue_metrics'").all();
console.log('revenue_metrics pre-existing:', existing.length > 0);
let applied = 0;
for (const stmt of statements) {
  try { db.exec(stmt); applied++; }
  catch (e) { console.log('SKIP stmt:', e.message); }
}
console.log('Applied:', applied, '/', statements.length);
const after = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='revenue_metrics'").all();
console.log('revenue_metrics now:', after.length > 0);
db.close();
