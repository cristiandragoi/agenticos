const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.resolve('server/data/agentic-os.db');
const db = new Database(dbPath, { readonly: true });

const tasks = db.prepare("SELECT task_id, title, status, worker, created_at FROM background_tasks").all();
console.log('Current background_tasks in DB:');
console.table(tasks);
