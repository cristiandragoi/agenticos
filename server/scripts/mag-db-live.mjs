// Re-inspect the RUNNING backend's actual DB (resources/server/data) + WAL.
import Database from 'better-sqlite3';
import fs from 'node:fs';
const dir = 'C:/Users/Cris/Desktop/desktop/Agentic_OS/Agentic OS/resources/server/data';
for (const f of fs.readdirSync(dir)) {
  const p = dir + '/' + f;
  const st = fs.statSync(p);
  console.log('FILE', f, st.size, st.mtime.toISOString());
}
const p = dir + '/agentic-os.db';
const db = new Database(p, { readonly: true });
const cols = db.prepare('PRAGMA table_info(magnitude_runs)').all().map((c) => c.name);
console.log('COLUMNS_NOW', cols.join(','));
console.log('HAS_PROJECT_ID', cols.includes('project_id'));
db.close();
