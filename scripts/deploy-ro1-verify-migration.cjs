/* RO1 deploy: verify canonical DB migration applied by packaged backend */
const path = 'C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db';
const Database = require('C:/Users/Cris/Desktop/desktop/Agentic_OS/Agentic OS/resources/server/node_modules/better-sqlite3');
const db = new Database(path, { readonly: true });
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'revenue%' ORDER BY name").all().map(t => t.name);
console.log('revenue tables:', tables);
const need = ['revenue_missions','revenue_experiments','revenue_experiment_events','revenue_ledger_entries','revenue_distribution_channels','revenue_compliance_records','revenue_human_gates','revenue_metrics'];
const missing = need.filter(t => !tables.includes(t));
console.log('MISSING:', missing.length ? missing : 'NONE');
const mig = db.prepare("SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at").all();
console.log('migration rows:', mig.length);
console.log('last 3:', mig.slice(-3));
// row counts (read-only sanity)
for (const t of need) {
  try { console.log(t, 'rows:', db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c); } catch (e) { console.log(t, 'ERR', e.message); }
}
// integrity
console.log('integrity_check:', db.pragma('integrity_check', { simple: true }));
db.close();
