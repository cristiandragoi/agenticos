// Production DB truth: locate the running backend's canonical DB and inspect memory tables.
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
const require = createRequire(import.meta.url);
const SERVER_NM = 'B:/AgenticOS/server/node_modules/';

function loadDb(dbPath) {
  // Require better-sqlite3 from the server's node_modules (script lives in scripts/)
  const Database = require(path.join(SERVER_NM, 'better-sqlite3'));
  return new Database(dbPath, { readonly: true });
}

const candidates = [
  'C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db',
  'C:/Users/Cris/Desktop/desktop/Agentic_OS/Agentic OS/resources/server/data/agentic-os.db',
  'B:/AgenticOS/server/data/agentic-os.db',
];
for (const dbPath of candidates) {
  if (!fs.existsSync(dbPath)) { console.log('MISSING', dbPath); continue; }
  console.log('FOUND', dbPath, fs.statSync(dbPath).size, 'bytes, mtime', fs.statSync(dbPath).mtime.toISOString());
  try {
    const db = loadDb(dbPath);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'memory%' ORDER BY name").all();
    console.log('  memory tables:', JSON.stringify(tables.map(t => t.name)));
    for (const t of tables) {
      const cnt = db.prepare(`SELECT COUNT(*) c FROM ${t.name}`).get();
      console.log(`  ${t.name}: ${cnt.c} rows`);
    }
    // memory_records status distribution
    try {
      const dist = db.prepare("SELECT status, COUNT(*) c FROM memory_records GROUP BY status").all();
      console.log('  memory_records by status:', JSON.stringify(dist));
      const scopes = db.prepare("SELECT scope, COUNT(*) c FROM memory_records GROUP BY scope ORDER BY c DESC LIMIT 8").all();
      console.log('  memory_records by scope:', JSON.stringify(scopes));
      const src = db.prepare("SELECT source_worker, COUNT(*) c FROM memory_records GROUP BY source_worker ORDER BY c DESC").all();
      console.log('  by source_worker:', JSON.stringify(src));
      const byType = db.prepare("SELECT type, COUNT(*) c FROM memory_records GROUP BY type").all();
      console.log('  by type:', JSON.stringify(byType));
    } catch (e) { console.log('  memory_records query err', String(e).slice(0, 150)); }
    db.close();
  } catch (e) { console.log('  ERR', String(e).slice(0, 200)); }
}
