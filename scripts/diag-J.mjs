// Diagnose: what did the run-now for routine-8be04c2f actually produce?
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Database = require('B:/AgenticOS/server/node_modules/better-sqlite3');
const db = new Database('C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db', { readonly: true });
const rid = 'routine-8be04c2f-b846-4b07-bfe9-6653b5f1af04';
console.log('--- schedule_executions for routine ---');
console.log(JSON.stringify(db.prepare('SELECT id, outcome, background_task_id, run_id, project_task_id, verification_id, verdict, error, triggered_at FROM schedule_executions WHERE routine_id = ? ORDER BY triggered_at DESC').all(rid), null, 1));
console.log('--- recent background tasks (any routineId metadata) ---');
console.log(JSON.stringify(db.prepare("SELECT task_id, status, worker, metadata FROM background_tasks ORDER BY created_at DESC LIMIT 5").all(), null, 1));
