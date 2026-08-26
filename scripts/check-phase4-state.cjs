// Read-only Phase 4 state inspection — authoritative live userData DB
const path = require('path');
const Database = require(path.join(process.cwd(), 'server', 'node_modules', 'better-sqlite3'));

const dbPath = 'C:\\Users\\Cris\\AppData\\Roaming\\agenticos\\data\\agentic-os.db';
const db = new Database(dbPath, { readonly: true });

function tables() {
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
  return rows.map(r => r.name);
}

const t = tables();
console.log('=== maintenance-related tables ===');
console.log(t.filter(n => /maint|change|repair|supervisor/i.test(n)));

if (t.includes('maintenance_change_sets')) {
  console.log('\n=== maintenance_change_sets rows ===');
  const cols = db.prepare("PRAGMA table_info(maintenance_change_sets)").all().map(c => c.name);
  console.log('cols:', cols.join(', '));
  const rows = db.prepare("SELECT * FROM maintenance_change_sets ORDER BY rowid DESC LIMIT 5").all();
  for (const r of rows) {
    console.log(JSON.stringify(r, null, 2).slice(0, 1200));
  }
}

if (t.includes('execution_results')) {
  console.log('\n=== recent execution_results (last 8) ===');
  const cols = db.prepare("PRAGMA table_info(execution_results)").all().map(c => c.name);
  const hasStatus = cols.includes('status');
  const hasType = cols.includes('result_type') || cols.includes('resultType');
  console.log('cols:', cols.join(', '));
  const rows = db.prepare("SELECT * FROM execution_results ORDER BY rowid DESC LIMIT 8").all();
  for (const r of rows) {
    const so = r.structured_output || r.structuredOutput || '';
    let rt = '';
    try { rt = JSON.parse(so).resultType || ''; } catch (e) { rt = '(unparsed)'; }
    console.log(`id=${r.id} status=${r.status} resultType=${rt} created=${r.created_at || r.createdAt || '?'}`);
  }
}

if (t.includes('conversations')) {
  console.log('\n=== recent conversations (last 5) ===');
  const cols = db.prepare("PRAGMA table_info(conversations)").all().map(c => c.name);
  const idCol = cols.find(c => /^id$/.test(c));
  const titleCol = cols.find(c => /title/.test(c));
  const tsCol = cols.find(c => /created/.test(c));
  const rows = db.prepare(`SELECT ${idCol}, ${titleCol || idCol}, ${tsCol || idCol} FROM conversations ORDER BY rowid DESC LIMIT 5`).all();
  for (const r of rows) console.log(JSON.stringify(r));
}

db.close();
console.log('\nDONE (read-only)');
