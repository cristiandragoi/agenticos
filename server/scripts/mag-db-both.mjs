// Check columns in BOTH candidate DBs (deployed server/data + AppData).
import Database from 'better-sqlite3';
import fs from 'node:fs';
const candidates = [
  'C:/Users/Cris/Desktop/desktop/Agentic_OS/Agentic OS/resources/server/data/agentic-os.db',
  'C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db',
];
for (const p of candidates) {
  if (!fs.existsSync(p)) { console.log('MISSING', p); continue; }
  try {
    const db = new Database(p, { readonly: true });
    const has = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='magnitude_runs'`).get();
    if (has) {
      const cols = db.prepare('PRAGMA table_info(magnitude_runs)').all().map((c) => c.name);
      console.log('TABLE-EXISTS', p, 'cols:', cols.join(','));
    } else {
      console.log('NO-TABLE', p);
    }
    db.close();
  } catch (e) {
    console.log('ERR', p, String(e).slice(0, 100));
  }
}
