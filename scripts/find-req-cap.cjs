const path = require('path');
const Database = require(path.resolve(__dirname, '../server/node_modules/better-sqlite3'));

for (const dbPath of ['B:/AgenticOS/server/data/agentic-os.db', 'C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db']) {
  console.log(`Checking DB: ${dbPath}`);
  const db = new Database(dbPath);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name);
  for (const table of tables) {
    try {
      const rows = db.prepare(`SELECT * FROM ${table}`).all();
      for (const row of rows) {
        const json = JSON.stringify(row);
        if (json.includes('requiredCapabilities')) {
          console.log(`  Table [${table}] row:`, Object.keys(row).map(k => `${k}=${String(row[k]).slice(0, 40)}`).join(', '));
        }
      }
    } catch (_) {}
  }
}
