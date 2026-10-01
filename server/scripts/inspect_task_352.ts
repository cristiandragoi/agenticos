import Database from 'better-sqlite3';

const dbPath = 'C:\\Users\\cd-pr\\AppData\\Roaming\\AgenticOS\\data\\agentic-os.db';
const db = new Database(dbPath, { readonly: true });

const task = db.prepare("SELECT * FROM background_tasks WHERE task_id = 'bgtask-352e2bf60'").get();
console.log('Task bgtask-352e2bf60:', JSON.stringify(task, null, 2));

const events = db.prepare("SELECT * FROM background_task_events WHERE task_id = 'bgtask-352e2bf60' ORDER BY created_at ASC").all();
console.log('Events count:', events.length);
for (const e of events) {
  console.log(`[${e.created_at}] stage=${e.stage} status=${e.status} msg=${e.message}`);
}

db.close();
