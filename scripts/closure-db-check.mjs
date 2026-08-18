// Which DB does the RUNNING packaged backend (PID from health) use, and does it
// have the closure schema + any promoted candidates? Read-only.
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const SERVER_NM = 'B:/AgenticOS/server/node_modules/';
const Database = require(path.join(SERVER_NM, 'better-sqlite3'));

for (const dbPath of [
  'C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db',
  'B:/AgenticOS/server/data/agentic-os.db',
]) {
  console.log('===', dbPath);
  try {
    const db = new Database(dbPath, { readonly: true });
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'memory%' ORDER BY name").all().map(t => t.name);
    console.log('  tables:', tables.includes('memory_candidates') ? 'candidates OK' : 'NO candidates table');
    if (tables.includes('memory_candidates')) {
      const c = db.prepare('SELECT COUNT(*) c FROM memory_candidates').get();
      console.log('  candidates:', c.c);
    }
    const cols = db.prepare('PRAGMA table_info(memory_records)').all().map(x => x.name);
    console.log('  verification_status:', cols.includes('verification_status'));
    // Check for closure-live artifacts
    const human = db.prepare("SELECT COUNT(*) c FROM memory_records WHERE verification_status='human_confirmed'").get();
    const verified = db.prepare("SELECT COUNT(*) c FROM memory_records WHERE verification_status='verified'").get();
    console.log('  human_confirmed:', human.c, 'verified:', verified.c);
    db.close();
  } catch (e) { console.log('  ERR', String(e).slice(0, 120)); }
}
