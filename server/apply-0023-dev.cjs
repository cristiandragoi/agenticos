// Apply migration 0023 (revenue operator tables) to the dev DB, after backup.
// Dev-only diagnostic DB — the packaged DB is untouched.
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const dbPath = path.resolve(__dirname, 'data/agentic-os.db');
const sqlPath = path.resolve(__dirname, 'drizzle/0023_revenue_operator.sql');
const backupPath = dbPath + '.backup-0023-' + new Date().toISOString().replace(/[:.]/g, '-');

// 1. Backup
fs.copyFileSync(dbPath, backupPath);
console.log('Backup:', backupPath);

const sql = fs.readFileSync(sqlPath, 'utf-8');
const statements = sql.split('--> statement-breakpoint').map((s) => s.trim()).filter(Boolean);

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
// Pre-flight: confirm the target tables are NOT present yet (avoid double-create)
const existing = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('revenue_missions','revenue_experiments','revenue_experiment_events','revenue_ledger_entries','revenue_distribution_channels','revenue_compliance_records','revenue_human_gates')").all();
console.log('Pre-existing revenue tables:', existing.length ? existing.map((r) => r.name).join(', ') : '(none)');

let applied = 0;
for (const stmt of statements) {
  // Skip index-on-missing-table hazards gracefully: run each; record errors
  try {
    db.exec(stmt);
    applied++;
  } catch (e) {
    console.log('SKIP stmt (likely exists):', e.message);
  }
}
console.log('Applied statements:', applied, '/', statements.length);

// Verify tables now exist
const after = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'revenue%' ORDER BY name").all();
console.log('Revenue tables now:', after.map((r) => r.name).join(', '));
db.close();
