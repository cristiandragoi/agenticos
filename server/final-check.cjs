const path = require('path');
const Database = require(path.resolve('B:/AgenticOS/server/node_modules/better-sqlite3'));

const db = new Database('C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db', { readonly: true });

console.log('=== supervisor state ===');
console.log(JSON.stringify(db.prepare("SELECT * FROM revenue_supervisor_state WHERE id='supervisor-singleton'").get()));

console.log('\n=== tasks/runs created since boot (~17:49) ===');
const tasks = db.prepare("SELECT id, title, status, created_at FROM tasks WHERE created_at > '2026-08-20T17:49:00' ORDER BY created_at").all();
console.log('tasks:', JSON.stringify(tasks, null, 2));

const runs = db.prepare("SELECT id, task_id, status, trigger, created_at FROM runs WHERE created_at > '2026-08-20T17:49:00' ORDER BY created_at").all();
console.log('runs:', JSON.stringify(runs, null, 2));

// Any supervisor continuation tasks (task-sup-*) or capability dispatcher runs beyond the proof?
const supTasks = db.prepare("SELECT COUNT(*) c FROM tasks WHERE id LIKE 'task-sup-%' AND created_at > '2026-08-20T17:49:00'").get().c;
const capRuns = db.prepare("SELECT COUNT(*) c FROM runs WHERE trigger = 'capability_dispatcher' AND created_at > '2026-08-20T17:49:00'").get().c;
console.log('\n=== revenue continuation check (since boot) ===');
console.log('supervisor continuation tasks (task-sup-*):', supTasks);
console.log('capability_dispatcher runs:', capRuns);

// Experiments state summary
console.log('\n=== experiments (mission-616808fe-) status ===');
console.log(JSON.stringify(db.prepare("SELECT status, COUNT(*) c FROM revenue_experiments WHERE mission_id = 'mission-616808fe-' GROUP BY status").all()));

db.close();
