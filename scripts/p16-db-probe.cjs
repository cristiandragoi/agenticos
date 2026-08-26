// Read-only: goal final answer + task verification state.
const Database = require('B:/AgenticOS/server/node_modules/better-sqlite3');
const path = require('path');
const dbPath = path.join(process.env.APPDATA, 'agenticos', 'data', 'agentic-os.db');
const db = new Database(dbPath, { readonly: true, fileMustExist: true });

const g = db.prepare("SELECT run_summary FROM goals WHERE id='goal-f882a4b2-'").get();
console.log('=== goal run_summary ===');
try {
  const rs = JSON.parse(g.run_summary || '{}');
  console.log('finalAnswer:', (rs.finalAnswer || rs.message || '(none)').slice(0, 1200));
  console.log('provider:', rs.provider, 'model:', rs.model);
} catch (e) { console.log('raw:', String(g.run_summary).slice(0, 1200)); }

const t = db.prepare("SELECT status, current_stage, progress_message, test_state, build_state, verification_state, files_changed, result_text, last_error FROM background_tasks WHERE task_id='bgtask-23d51e1e5'").get();
console.log('\n=== task state ===');
console.log(JSON.stringify(t, null, 2));
db.close();
