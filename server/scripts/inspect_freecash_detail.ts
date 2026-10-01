import Database from 'better-sqlite3';

const dbPath = 'C:\\Users\\cd-pr\\AppData\\Roaming\\AgenticOS\\data\\agentic-os.db';
const db = new Database(dbPath, { readonly: true });

console.log('Columns of background_tasks:');
const cols = db.prepare("PRAGMA table_info(background_tasks)").all();
console.log(cols);

console.log('Sample rows:');
const rows = db.prepare("SELECT * FROM background_tasks LIMIT 3").all();
console.log(rows);

db.close();
