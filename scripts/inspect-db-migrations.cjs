const path = require('path');
const Database = require(path.resolve(__dirname, '../server/node_modules/better-sqlite3'));
const fs = require('fs');

const dbPath = path.resolve(__dirname, '../server/data/agentic-os.db');
const db = new Database(dbPath);

console.log('Database path:', dbPath);
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log('Tables in DB:', tables.map(t => t.name));

try {
  const migs = db.prepare('SELECT * FROM __drizzle_migrations').all();
  console.log('Drizzle migrations table entries:', migs);
} catch (e) {
  console.log('__drizzle_migrations table does not exist or query error:', e.message);
}

const drizzleFolder = path.resolve(__dirname, '../server/drizzle');
if (fs.existsSync(drizzleFolder)) {
  console.log('Files in drizzle folder:', fs.readdirSync(drizzleFolder));
}
