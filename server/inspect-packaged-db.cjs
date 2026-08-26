// Read-only inspection of packaged DB migration state (no mutation).
const Database = require('better-sqlite3');
const path = require('path');

function inspect(label, dbPath) {
  console.log(`\n=== ${label} ===`);
  console.log('path:', dbPath);
  let db;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
  } catch (e) {
    console.log('OPEN ERROR:', e.message);
    return;
  }
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'revenue%' ORDER BY name").all();
    console.log('revenue tables:', tables.length ? tables.map(t => t.name).join(', ') : '(none)');
    const rm = db.prepare("SELECT name FROM sqlite_master WHERE name='revenue_metrics'").get();
    console.log('revenue_metrics:', rm ? 'PRESENT' : 'MISSING');
    const migCount = db.prepare('SELECT COUNT(*) AS n FROM __drizzle_migrations').get();
    console.log('__drizzle_migrations count:', migCount.n);
    const journal = db.prepare("SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 3").all();
    console.log('last 3 migration hashes:', JSON.stringify(journal));
  } catch (e) {
    console.log('INSPECT ERROR:', e.message);
  }
  db.close();
}

inspect('CANONICAL userData DB', 'C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db');
inspect('LEGACY resources/server DB', 'C:/Users/Cris/Desktop/desktop/Agentic_OS/Agentic OS/resources/server/data/agentic-os.db');
