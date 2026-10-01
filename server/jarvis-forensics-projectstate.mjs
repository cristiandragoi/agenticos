// READ-ONLY: dump the authoritative AgenticOS project/revenue state straight from SQLite.
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const candidates = [
  path.join(process.env.APPDATA || '', 'AgenticOS', 'data', 'agentic-os.db'),
  'D:/AgenticOS/server/data/agentic-os.db',
  path.join(process.env.APPDATA || '', 'AgenticOS', 'agentic-os.db'),
];
const dbPath = candidates.find((c) => c && fs.existsSync(c));
if (!dbPath) { console.error('DB_NOT_FOUND. tried:\n' + candidates.join('\n')); process.exit(1); }
console.log(`DB: ${dbPath}  (${(fs.statSync(dbPath).size / 1024 / 1024).toFixed(2)} MB, mtime ${fs.statSync(dbPath).mtime.toISOString()})`);

const db = new Database(dbPath, { readonly: true, fileMustExist: true });
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((r) => r.name);
console.log(`\nTABLES (${tables.length}):`);
const counts = {};
for (const t of tables) {
  try { counts[t] = db.prepare(`SELECT COUNT(*) c FROM "${t}"`).get().c; } catch { counts[t] = 'ERR'; }
}
const nonEmpty = tables.filter((t) => counts[t] > 0);
console.log(`  non-empty (${nonEmpty.length}): ${nonEmpty.map((t) => `${t}=${counts[t]}`).join(', ')}`);
console.log(`  empty (${tables.length - nonEmpty.length}): ${tables.filter((t) => !counts[t]).join(', ')}`);

const show = (label, sql, params = []) => {
  console.log(`\n--- ${label} ---`);
  try {
    const rows = db.prepare(sql).all(...params);
    if (!rows.length) { console.log('  (none)'); return rows; }
    for (const r of rows) console.log('  ' + JSON.stringify(r));
    return rows;
  } catch (e) { console.log(`  ERR ${e.message}`); return []; }
};

show('PROJECTS', 'SELECT id,name,status,priority,revenue_vertical,workspace_path,updated_at FROM projects ORDER BY priority');

// Which tables carry a project_id column?
console.log('\n--- TABLES WITH project_id COLUMN ---');
const projectLinked = [];
for (const t of tables) {
  try {
    const cols = db.prepare(`PRAGMA table_info("${t}")`).all().map((c) => c.name);
    if (cols.includes('project_id')) {
      const c = db.prepare(`SELECT COUNT(*) c FROM "${t}"`).get().c;
      const fc = db.prepare(`SELECT COUNT(*) c FROM "${t}" WHERE project_id='proj-free-cash'`).get().c;
      projectLinked.push({ table: t, rows: c, freeCashRows: fc });
      console.log(`  ${t}: total=${c} free-cash=${fc}`);
    }
  } catch { /* ignore */ }
}

// Revenue Operator domain tables
console.log('\n=============== REVENUE OPERATOR ===============');
for (const t of tables.filter((x) => /revenue|opportunit|mission|experiment|ledger|channel|complianc|gate/i.test(x))) {
  const cols = db.prepare(`PRAGMA table_info("${t}")`).all().map((c) => c.name);
  console.log(`\n--- ${t} (rows=${counts[t]}) cols: ${cols.join(',')}`);
  if (counts[t] > 0) {
    const rows = db.prepare(`SELECT * FROM "${t}" LIMIT 5`).all();
    for (const r of rows) console.log('  ' + JSON.stringify(r).slice(0, 500));
  }
}

// Background tasks / runs for Free Cash
console.log('\n=============== FREE CASH CONTENTS ===============');
for (const t of projectLinked.filter((p) => p.freeCashRows > 0)) {
  const rows = db.prepare(`SELECT * FROM "${t.table}" WHERE project_id='proj-free-cash' LIMIT 10`).all();
  console.log(`\n--- ${t.table} (${t.freeCashRows} rows for Free Cash) ---`);
  for (const r of rows) console.log('  ' + JSON.stringify(r).slice(0, 400));
}

db.close();
