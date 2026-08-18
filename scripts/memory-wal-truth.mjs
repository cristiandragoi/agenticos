// Which DB actually received the resilience acceptance turns? Check WAL files + message rows.
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const SERVER_NM = 'B:/AgenticOS/server/node_modules/';
const Database = require(path.join(SERVER_NM, 'better-sqlite3'));

const dbs = [
  'C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db',
  'C:/Users/Cris/Desktop/desktop/Agentic_OS/Agentic OS/resources/server/data/agentic-os.db',
];
for (const dbPath of dbs) {
  console.log('===', dbPath);
  for (const suffix of ['', '-wal', '-shm']) {
    const p = dbPath + suffix;
    if (fs.existsSync(p)) console.log('  ', suffix || '(main)', fs.statSync(p).size, fs.statSync(p).mtime.toISOString());
  }
  try {
    const db = new Database(dbPath, { readonly: true });
    const acc = db.prepare("SELECT COUNT(*) c FROM conversation_messages WHERE content LIKE '%resilience-acc%' OR metadata LIKE '%resilience-acc%'").get();
    console.log('  resilience-acc rows:', acc.c);
    const recent = db.prepare("SELECT role, substr(content,1,50) txt, created_at FROM conversation_messages ORDER BY created_at DESC LIMIT 5").all();
    for (const r of recent) console.log('   recent:', r.role, '|', r.txt, '|', r.created_at);
    db.close();
  } catch (e) { console.log('  ERR', String(e).slice(0, 150)); }
}
