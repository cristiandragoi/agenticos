import Database from 'better-sqlite3';

const db = new Database('C:/Users/cd-pr/AppData/Roaming/agenticos/data/agentic-os.db');
const res = db.prepare("UPDATE background_tasks SET status = 'cancelled' WHERE status = 'blocked' AND project_id = 'proj-free-cash'").run();
console.log('Cancelled blocked free cash tasks in db, changes:', res.changes);

const count = db.prepare("SELECT count(*) as c FROM background_tasks WHERE status = 'blocked'").get();
console.log('Remaining blocked tasks:', count.c);
