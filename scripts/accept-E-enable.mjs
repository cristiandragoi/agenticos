// Test E — enable/disable across a fire window.
// Uses a fresh per-minute hermes routine. Disable → zero fires over a window →
// re-enable → exactly one fire in the next window.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const API = 'http://127.0.0.1:4000/api';
async function post(path, body) { const r = await fetch(`${API}${path}`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) }); return await r.json().catch(()=>({})); }
async function get(path) { const r = await fetch(`${API}${path}`); return await r.json().catch(()=>({})); }

const Database = require('B:/AgenticOS/server/node_modules/better-sqlite3');
const db = new Database('C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db');
const countExecs = (rid) => db.prepare('SELECT COUNT(*) c FROM schedule_executions WHERE routine_id=?').get(rid).c;

const proj = await post('/projects', { name: `EnableE ${Date.now()}`, tags: ['acceptance'] });
const projectId = proj.id;
const routine = await post('/routines', {
  projectId, name: 'EnableDisable Smoke E',
  objective: 'Answer in one word: what is the capital of France?', worker: 'hermes',
  cronExpression: '* * * * *', enabled: true,
});
const rid = routine.routineId;
console.log('ROUTINE_ID=' + rid + ' SCHEDULE_ID=' + routine.scheduleId);

// Disable BEFORE the next minute boundary (do it now, then measure a window).
await post(`/routines/${rid}/disable`, {});
const afterDisable = countExecs(rid);
console.log('EXEC_COUNT_AT_DISABLE=' + afterDisable);

// Wait ~75s (spans at least one minute boundary). Count must stay equal.
await new Promise(r => setTimeout(r, 75000));
const duringDisabled = countExecs(rid);
console.log('EXEC_COUNT_WHILE_DISABLED=' + duringDisabled + ' (must equal ' + afterDisable + ')');

// Re-enable.
await post(`/routines/${rid}/enable`, {});
const afterEnable = countExecs(rid);
console.log('EXEC_COUNT_AT_ENABLE=' + afterEnable);

// Wait ~75s for the next minute boundary; exactly one new fire expected.
await new Promise(r => setTimeout(r, 75000));
const afterReenableWindow = countExecs(rid);
console.log('EXEC_COUNT_AFTER_REENABLE=' + afterReenableWindow + ' (expect ' + (afterEnable+1) + ')');

// routine/schedule state consistency
const rstate = db.prepare('SELECT enabled FROM routines WHERE routine_id=?').get(rid);
const sstate = db.prepare('SELECT enabled FROM schedules WHERE id=?').get(routine.body.scheduleId);
console.log('ROUTINE_ENABLED=' + rstate.enabled + ' SCHEDULE_ENABLED=' + sstate.enabled);

// Disable to stop noise.
await post(`/routines/${rid}/disable`, {});
db.close();
