// Find the most recent Jarvis conversation id from the deployed DB (read-only).
import fs from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const DB = 'C:/Users/Cris/Desktop/desktop/Agentic_OS/Agentic OS/resources/server/data/agentic-os.db';
try {
  const Database = require('better-sqlite3');
  const db = new Database(DB, { readonly: true });
  const rows = db.prepare("select id, title, created_at from conversations order by created_at desc limit 8").all();
  console.log(JSON.stringify(rows, null, 2));
  db.close();
} catch (e) {
  console.log('ERR', String(e).slice(0, 300));
}
