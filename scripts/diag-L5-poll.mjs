import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Database = require('B:/AgenticOS/server/node_modules/better-sqlite3');
const db = new Database('C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db', { readonly: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const seId = 'sched-exec-432bed1e-68c4-49c7-bac3-4027cb1cfd9e';
let se = null;
for (let i = 0; i < 60; i++) {
  await sleep(2000);
  se = db.prepare('SELECT * FROM schedule_executions WHERE id = ?').get(seId);
  if (se && ['completed', 'execution_failed', 'cancelled', 'dispatch_failed'].includes(se.outcome)) break;
}
console.log('OUTCOME=' + se.outcome);
console.log('ERROR=' + (se.error ?? 'null'));
console.log('BG_TASK=' + se.background_task_id);
console.log('PROJECT_TASK=' + se.project_task_id);
console.log('RUN_ID=' + se.run_id);
console.log('RESULT_ID=' + (se.result_id ?? 'null'));
console.log('VERIFICATION_ID=' + (se.verification_id ?? 'null'));
const run = db.prepare('SELECT status, final_result_id FROM execution_runs WHERE id = ?').get(se.run_id);
console.log('RUN_STATUS=' + run?.status);
const ver = db.prepare('SELECT id, verdict FROM verifications WHERE target_run_id = ?').all(se.run_id);
console.log('VERDICTS=' + JSON.stringify(ver));
