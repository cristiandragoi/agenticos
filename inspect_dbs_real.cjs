const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.resolve('server/data/agentic_os.db');
console.log('Opening database:', dbPath);

const db = new Database(dbPath, { readonly: true });

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log('Tables in agentic_os.db:', tables.map(t => t.name));

for (const table of tables.map(t => t.name)) {
  console.log(`\n=== Table: ${table} ===`);
  try {
    const rows = db.prepare(`SELECT * FROM ${table}`).all();
    console.log(`Rows count: ${rows.length}`);
    if (rows.length > 0) {
      console.log('Sample rows (up to 20):');
      console.table(rows.slice(0, 20));
    }
  } catch (e) {
    console.log(`Error reading table ${table}:`, e.message);
  }
}
