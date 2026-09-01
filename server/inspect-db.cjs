const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.resolve(__dirname, 'data', 'agentic-os.db');
const db = new Database(dbPath);

console.log('=== TABLES IN DB ===');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log(tables.map(t => t.name));

console.log('\n=== GOALS ===');
try {
  const goals = db.prepare("SELECT id, title, status, created_at FROM goals").all();
  console.log('Total goals:', goals.length);
  console.log(JSON.stringify(goals, null, 2));
} catch (e) {
  console.log('Error reading goals:', e.message);
}

console.log('\n=== BACKGROUND TASKS ===');
try {
  const bg = db.prepare("SELECT id, title, status, created_at, worker FROM background_tasks").all();
  console.log('Total background_tasks:', bg.length);
  console.log(JSON.stringify(bg, null, 2));
} catch (e) {
  console.log('Error reading background_tasks:', e.message);
}
