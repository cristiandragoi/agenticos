// Read-only DB probe: query the repo DB exactly as the server would (better-sqlite3)
import Database from 'better-sqlite3';
import fs from 'fs';

const paths = [
  'B:/AgenticOS/server/data/agentic-os.db',
  'C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db',
  'C:/Users/Cris/Desktop/desktop/Agentic_OS/Agentic OS/resources/server/data/agentic-os.db',
];

for (const p of paths) {
  console.log('==== ', p, fs.existsSync(p) ? `(${fs.statSync(p).size} bytes)` : 'MISSING');
  if (!fs.existsSync(p)) continue;
  try {
    const db = new Database(p, { readonly: true });
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE 'revenue%' OR name='tasks') ORDER BY name").all().map(r => r.name);
    console.log('  revenue-ish tables:', JSON.stringify(tables));
    for (const t of ['revenue_supervisor_state', 'revenue_missions', 'revenue_experiments', 'revenue_human_gates']) {
      try {
        const n = db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n;
        console.log(`  ${t}: ${n} rows`);
      } catch (e) { console.log(`  ${t}: (no table)`); }
    }
    try {
      console.log('  state:', JSON.stringify(db.prepare('SELECT * FROM revenue_supervisor_state').all()));
    } catch {}
    try {
      console.log('  missions:', JSON.stringify(db.prepare('SELECT id, title, status FROM revenue_missions LIMIT 20').all()));
    } catch {}
    db.close();
  } catch (e) {
    console.log('  OPEN ERROR:', e.message);
  }
}
