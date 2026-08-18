// Test J — Routine cancellation. Long-running Hermes routine, run-now, cancel
// the background task mid-flight, verify cancellation is truthful + occurrence-scoped.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Database = require('B:/AgenticOS/server/node_modules/better-sqlite3');
const prodDb = new Database('C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db', { readonly: true });
const API = 'http://127.0.0.1:4000/api';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function post(path, body) {
  const r = await fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
async function get(path) {
  const r = await fetch(API + path);
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

// J1 — create a long-running Hermes routine
const proj = await post('/projects', { name: `CancelJ ${Date.now()}`, tags: ['acceptance'] });
const projectId = proj.body.id;
const routine = await post('/routines', {
  projectId,
  name: 'Cancellation Smoke J',
  objective: 'Research the history, architecture, and modern usage of the Python programming language, and produce a detailed multi-part research report covering its design philosophy, concurrency model, package ecosystem, and performance characteristics.',
  worker: 'hermes',
  taskTemplate: { objective: 'Research Python comprehensively and produce a detailed multi-part report.', worker: 'hermes', input: { mode: 'research' } },
  cronExpression: '*/30 * * * *',
  timezone: 'UTC',
  timeoutSeconds: 600,
});
const routineId = routine.body.routineId;
const scheduleId = routine.body.scheduleId;
console.log('PROJECT_ID=' + projectId);
console.log('ROUTINE_ID=' + routineId);
console.log('SCHEDULE_ID=' + scheduleId);

// J1 — pre-state
const runsBefore = prodDb.prepare('SELECT COUNT(*) c FROM schedule_executions WHERE routine_id = ?').get(routineId).c;
console.log('RUNS_BEFORE=' + runsBefore);
console.log('ROUTINE_ENABLED=' + (routine.body.enabled));
console.log('SCHEDULE_ENABLED=' + (await get('/schedules')).body.find(s => s.id === scheduleId)?.enabled);

// J2 — start manual occurrence (fire-and-forget; run-now blocks server-side until terminal)
console.log('--- J2: firing run-now (fire-and-forget) ---');
const runNowPromise = post(`/routines/${routineId}/run-now`);
const t0 = Date.now();

// Poll for the newly created background task (status running)
let bgTask = null;
for (let i = 0; i < 40 && !bgTask; i++) {
  await sleep(500);
  const tasks = (await get('/background-tasks?activeOnly=true')).body;
  const arr = Array.isArray(tasks) ? tasks : (tasks.tasks || []);
  bgTask = arr.find(t => {
    let md = t.metadata;
    if (typeof md === 'string') { try { md = JSON.parse(md); } catch { md = {}; } }
    return md && md.routineId === routineId && (t.status === 'running' || t.status === 'planning');
  });
}
if (!bgTask) { console.log('ERROR: no running background task found'); process.exit(1); }
const backgroundTaskId = bgTask.taskId || bgTask.id;
console.log('BACKGROUND_TASK_ID=' + backgroundTaskId);
console.log('BG_STATUS_AT_START=' + bgTask.status);

// resolve worker run via schedule_executions
const seRow = prodDb.prepare('SELECT * FROM schedule_executions WHERE routine_id = ? ORDER BY triggered_at DESC LIMIT 1').get(routineId);
console.log('SCHEDULE_EXECUTION_ID=' + seRow.id);
console.log('WORKER_RUN_ID=' + seRow.run_id);
console.log('SE_OUTCOME_AT_START=' + seRow.outcome);

// J3 — cancel
console.log('--- J3: cancelling background task ---');
const cancelResp = await post(`/background-tasks/${backgroundTaskId}/cancel`, { reason: 'Test J cancellation' });
console.log('CANCEL_HTTP=' + cancelResp.status);
console.log('CANCEL_TS=' + new Date().toISOString());

// J4 — wait terminal
let finalBg = null, finalSe = null;
for (let i = 0; i < 60; i++) {
  await sleep(1000);
  const t = (await get(`/background-tasks/${backgroundTaskId}`)).body;
  finalSe = prodDb.prepare('SELECT * FROM schedule_executions WHERE id = ?').get(seRow.id);
  if (t && ['completed', 'failed', 'cancelled', 'blocked'].includes(t.status)) { finalBg = t; break; }
}
console.log('--- J4: final state ---');
console.log('BG_FINAL_STATUS=' + finalBg?.status);
console.log('SE_FINAL_OUTCOME=' + finalSe?.outcome);
console.log('SE_FINAL_ERROR=' + (finalSe?.error ?? ''));
console.log('SE_FINAL_VERIFICATION_ID=' + (finalSe?.verification_id ?? 'null'));
console.log('SE_FINAL_VERDICT=' + (finalSe?.verdict ?? 'null'));
console.log('WORKER_RUN_STATUS=' + (prodDb.prepare('SELECT status FROM execution_runs WHERE id = ?').get(seRow.run_id)?.status));

// J5 — promotion check: no memory_candidates promoted for the cancelled run
const promotedForRun = prodDb.prepare("SELECT COUNT(*) c FROM memory_candidates WHERE source_run_id = ? AND status = 'promoted'").get(seRow.run_id).c;
console.log('PROMOTED_FOR_CANCELLED_RUN=' + promotedForRun);

// J6 — routine + schedule still exist and enabled
const routineAfter = (await get(`/routines/${routineId}`)).body;
const scheduleAfter = (await get('/schedules')).body.find(s => s.id === scheduleId);
console.log('ROUTINE_EXISTS=' + !!routineAfter?.routineId);
console.log('ROUTINE_ENABLED_AFTER=' + routineAfter?.enabled);
console.log('SCHEDULE_EXISTS=' + !!scheduleAfter);
console.log('SCHEDULE_ENABLED_AFTER=' + scheduleAfter?.enabled);

// J6b — second occurrence
console.log('--- J6: second run-now (should complete normally) ---');
const second = await post(`/routines/${routineId}/run-now`);
console.log('SECOND_RUNNOW_HTTP=' + second.status);
const secondSe = prodDb.prepare('SELECT * FROM schedule_executions WHERE routine_id = ? ORDER BY triggered_at DESC LIMIT 1').get(routineId);
console.log('SECOND_SCHEDULE_EXECUTION_ID=' + secondSe.id);
console.log('SECOND_IS_DIFFERENT=' + (secondSe.id !== seRow.id));
console.log('SECOND_OUTCOME=' + secondSe.outcome);
console.log('SECOND_BACKGROUND_TASK_ID=' + secondSe.background_task_id);
console.log('SECOND_VERDICT=' + (secondSe.verdict ?? 'null'));
console.log('SECOND_RUN_ID=' + secondSe.run_id);

// J7 — provenance integrity: first occurrence IDs unchanged by second run
const firstSeAgain = prodDb.prepare('SELECT * FROM schedule_executions WHERE id = ?').get(seRow.id);
console.log('--- J7: provenance integrity ---');
console.log('FIRST_SE_STILL_CANCELLED=' + (firstSeAgain.outcome === 'cancelled'));
console.log('FIRST_BG_TASK_ID=' + firstSeAgain.background_task_id);
console.log('FIRST_RUN_ID=' + firstSeAgain.run_id);
console.log('FIRST_VERIFICATION_ID=' + (firstSeAgain.verification_id ?? 'null'));

console.log('TOTAL_TIME_S=' + ((Date.now() - t0) / 1000).toFixed(1));
process.exit(0);
