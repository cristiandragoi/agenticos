import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
const db = new Database('C:/Users/Cris/AppData/Local/Temp/agenticos-devtest3/agentic-os.db', { readonly: true });

console.log('=== TABLES (goal-related) ===');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE '%goal%' OR name LIKE '%codex%')").all();
console.log(tables.map(t => t.name).join(', '));

console.log('\n=== GOAL goal-76f40abb- ===');
for (const t of tables) {
  const cols = db.prepare(`PRAGMA table_info(${t.name})`).all().map(c => c.name);
  if (cols.some(c => /id/i.test(c))) {
    try {
      const rows = db.prepare(`SELECT * FROM ${t.name} WHERE id LIKE 'goal-76f40abb%' OR id = 'goal-76f40abb-'`).all();
      if (rows.length) {
        console.log(`--- table ${t.name} (${rows.length} rows) ---`);
        for (const r of rows) {
          const o = { ...r };
          for (const k of Object.keys(o)) {
            if (typeof o[k] === 'string' && o[k].length > 400) o[k] = o[k].slice(0, 400) + '…[truncated]';
          }
          console.log(JSON.stringify(o, null, 2));
        }
      }
    } catch (e) { /* skip */ }
  }
}
db.close();
