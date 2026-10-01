const Database = require('better-sqlite3');
const db = new Database(process.env.APPDATA + '/agenticos/data/agentic-os.db');

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name);

console.log('Total tables:', tables.length);

for (const table of tables) {
  try {
    const rows = db.prepare(`SELECT * FROM "${table}"`).all();
    if (rows.length === 0) continue;
    for (const row of rows) {
      const s = JSON.stringify(row);
      const lower = s.toLowerCase();
      if (lower.includes('qbj') || lower.includes('bj') || s.includes('24') || s.includes('continue #7') || lower.includes('task 24')) {
        // filter down to relevant hits
        if (
          lower.includes('qbj') ||
          lower.includes('bj-') ||
          lower.includes('task-24') ||
          lower.includes('task 24') ||
          s.includes('continue #7') ||
          (row.id && (String(row.id).includes('24') || String(row.id).includes('7'))) ||
          (row.title && (String(row.title).includes('24') || String(row.title).includes('7') || String(row.title).includes('QBJ') || String(row.title).includes('BJ'))) ||
          (row.name && (String(row.name).includes('24') || String(row.name).includes('7') || String(row.name).includes('QBJ') || String(row.name).includes('BJ'))) ||
          (row.prompt && (String(row.prompt).includes('24') || String(row.prompt).includes('7') || String(row.prompt).includes('QBJ') || String(row.prompt).includes('BJ')))
        ) {
          console.log(`[TABLE: ${table}]`, row);
        }
      }
    }
  } catch (e) {
    // console.log(`Error reading ${table}:`, e.message);
  }
}
