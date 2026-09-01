import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.resolve('server/data/agentic-os.db');
const db = new Database(dbPath, { readonly: true });

console.log('=== TABLES IN DB ===');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log(tables.map(t => t.name));

console.log('\n=== GOALS ===');
try {
  const goals = db.prepare("SELECT id, title, status, created_at, source FROM goals").all();
  console.table(goals);
} catch (e) {
  try {
    const goals = db.prepare("SELECT * FROM goals").all();
    console.table(goals);
  } catch (e2) {
    console.log('Error reading goals:', e2.message);
  }
}

console.log('\n=== TASKS ===');
try {
  const tasks = db.prepare("SELECT id, title, status, createdAt FROM tasks").all();
  console.table(tasks);
} catch (e) {
  try {
    const tasks = db.prepare("SELECT * FROM tasks").all();
    console.table(tasks);
  } catch (e2) {
    console.log('Error reading tasks:', e2.message);
  }
}

console.log('\n=== BACKGROUND TASKS ===');
try {
  const bg = db.prepare("SELECT id, title, status, created_at, worker FROM background_tasks").all();
  console.table(bg);
} catch (e) {
  try {
    const bg = db.prepare("SELECT * FROM background_tasks").all();
    console.table(bg);
  } catch (e2) {
    console.log('Error reading background_tasks:', e2.message);
  }
}
