import Database from 'better-sqlite3';

const db = new Database('C:/Users/cd-pr/AppData/Roaming/agenticos/data/agentic-os.db', { readonly: true });
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name);

for (const tbl of tables) {
  try {
    const cols = db.prepare(`PRAGMA table_info(${tbl})`).all().map(c => c.name);
    for (const col of cols) {
      try {
        const found = db.prepare(`SELECT * FROM ${tbl} WHERE ${col} = 'goal-1790545900080-d92z0' LIMIT 5`).all();
        if (found.length) {
          console.log(`FOUND IN ${tbl}.${col}:`, JSON.stringify(found, null, 2));
        }
      } catch {}
    }
  } catch {}
}
