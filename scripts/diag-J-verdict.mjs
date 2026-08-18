// Confirm the second occurrence (bgtask-769d17834 / er-d6392a5d-7) genuinely
// verified PASS (not just 'completed'), then disable the test routine.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Database = require('B:/AgenticOS/server/node_modules/better-sqlite3');
const db = new Database('C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db', { readonly: true });
const bg = db.prepare('SELECT task_id, status, verification_state, result_text FROM background_tasks WHERE task_id = ?').get('bgtask-769d17834');
console.log('SECOND_BG=' + JSON.stringify(bg));
const run = db.prepare('SELECT id, status, final_result_id FROM execution_runs WHERE id = ?').get('er-d6392a5d-7');
console.log('SECOND_RUN=' + JSON.stringify(run));
const ver = db.prepare("SELECT id, verdict FROM verifications WHERE target_run_id = 'er-d6392a5d-7'").all();
console.log('SECOND_VERIFICATIONS=' + JSON.stringify(ver));
