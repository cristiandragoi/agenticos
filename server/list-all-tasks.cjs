const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.resolve(__dirname, 'data', 'agentic-os.db');
const db = new Database(dbPath);

console.log('=== GOALS ===');
const goals = db.prepare("SELECT id, original_goal, status, created_at FROM goals").all();
console.table(goals);

console.log('=== BACKGROUND TASKS ===');
const bg = db.prepare("SELECT task_id, title, status, created_at, worker, route FROM background_tasks").all();
console.table(bg);
