/* RO1 deploy: inspect canonical packaged DB state (read-only) */
const path = 'C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db';
const Database = require('C:/Users/Cris/Desktop/desktop/Agentic_OS/Agentic OS/resources/server/node_modules/better-sqlite3');
const db = new Database(path, { readonly: true });
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'revenue%' ORDER BY name").all();
console.log('revenue tables in canonical DB:', tables.map(t => t.name));
const mig = db.prepare("SELECT * FROM __drizzle_migrations ORDER BY created_at").all();
console.log('applied migrations:');
for (const m of mig) console.log(' ', JSON.stringify(m));
const argus = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'argus%' ORDER BY name").all();
console.log('argus tables:', argus.map(t => t.name));
try {
  const cnt = db.prepare("SELECT COUNT(*) c FROM revenue_missions").get();
  console.log('revenue_missions rows:', cnt.c);
} catch (e) { console.log('revenue_missions query error:', e.message); }
try {
  const gm = db.prepare("SELECT COUNT(*) c FROM revenue_operator_goals").get();
  console.log('revenue_operator_goals rows:', gm.c);
} catch (e) { console.log('revenue_operator_goals:', e.message); }
db.close();
