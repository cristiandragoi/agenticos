// List tables + key rows in a sqlite db (read-only), using better-sqlite3
// from the server's node_modules. No writes.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.join(__dirname, '..', 'server');
const require = createRequire(path.join(serverDir, 'package.json'));
const Database = require('better-sqlite3');
const dbPath = process.argv[2] || path.join(serverDir, 'data', 'agentic-os.db');

const db = new Database(dbPath, { readonly: true });
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((r) => r.name);
console.log('TABLES ' + JSON.stringify(tables));
for (const t of ['agent_provider_assignments', 'gateway_configuration']) {
  if (tables.includes(t)) {
    try {
      const rows = db.prepare(`SELECT * FROM ${t} LIMIT 5`).all();
      console.log('ROWS_' + t + ' ' + JSON.stringify(rows));
    } catch (e) {
      console.log('ERR_' + t + ' ' + String(e.message));
    }
  }
}
db.close();
