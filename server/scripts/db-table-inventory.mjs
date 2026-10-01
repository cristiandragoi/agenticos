/**
 * db-table-inventory.mjs — list tables per candidate SQLite database so the
 * authoritative store for a given domain (e.g. repair_incidents) can be found
 * instead of assumed. Read-only.
 */
import Database from 'better-sqlite3';
import fs from 'fs';

const candidates = process.argv.slice(2);
for (const file of candidates) {
  console.log('='.repeat(70));
  console.log('DB:', file);
  if (!fs.existsSync(file)) { console.log('  (missing)'); continue; }
  console.log('  size:', fs.statSync(file).size, 'bytes');
  try {
    const db = new Database(file, { readonly: true });
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
    console.log('  tables:', tables.length);
    const wanted = ['repair_incidents', 'repair_evidence', 'active_operational_goals', 'background_tasks', 'conversation_messages', 'projects'];
    for (const w of wanted) {
      const has = tables.some((t) => t.name === w);
      let n = '';
      if (has) {
        try { n = ' rows=' + db.prepare(`SELECT COUNT(*) c FROM ${w}`).get().c; } catch { n = ' (count failed)'; }
      }
      console.log(`   ${has ? 'YES' : ' no'} ${w}${n}`);
    }
    db.close();
  } catch (e) {
    console.log('  ERROR:', e.message);
  }
}
