const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.resolve(__dirname, 'data', 'agentic-os.db');
const db = new Database(dbPath);

function describeTable(tableName) {
  console.log(`\n=== SCHEMA OF ${tableName} ===`);
  const cols = db.prepare(`PRAGMA table_info(${tableName})`).all();
  console.log(cols.map(c => `${c.name} (${c.type})`).join(', '));
  const rows = db.prepare(`SELECT * FROM ${tableName}`).all();
  console.log(`Row count: ${rows.length}`);
  console.log('Rows:', JSON.stringify(rows, null, 2));
}

describeTable('goals');
describeTable('tasks');
describeTable('background_tasks');
