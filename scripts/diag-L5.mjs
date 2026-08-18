import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Database = require('B:/AgenticOS/server/node_modules/better-sqlite3');
const db = new Database('C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db', { readonly: true });
const rid = 'routine-cf29a3ee-cfe4-4d7b-993d-c57117e70817';
console.log('routine exists: ' + JSON.stringify(db.prepare('SELECT routine_id, name, enabled FROM routines WHERE routine_id = ?').get(rid)));
console.log('executions: ' + JSON.stringify(db.prepare('SELECT id, outcome, trigger_type, error FROM schedule_executions WHERE routine_id = ?').all(rid)));
console.log('bg tasks for routine: ' + JSON.stringify(db.prepare("SELECT task_id, status, last_error FROM background_tasks WHERE metadata LIKE ? ORDER BY created_at DESC LIMIT 3").all('%' + rid + '%')));
