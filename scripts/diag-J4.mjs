// Check the run-now response directly + dump background tasks around it.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const API = 'http://127.0.0.1:4000/api';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function post(path, body) { const r = await fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }); return { status: r.status, body: await r.json().catch(() => ({})) }; }
async function get(path) { const r = await fetch(API + path); return { status: r.status, body: await r.json().catch(() => ({})) }; }

const proj = await post('/projects', { name: `DiagJ4 ${Date.now()}` });
const projectId = proj.body.id;
const routine = await post('/routines', { projectId, name: 'DiagJ4', objective: 'Write a detailed report on TypeScript generics, variance, and conditional types with examples.', worker: 'hermes', taskTemplate: { objective: 'Detailed TypeScript generics report.', worker: 'hermes', input: { mode: 'research' } }, cronExpression: '*/30 * * * *', timezone: 'UTC', timeoutSeconds: 600 });
const rid = routine.body.routineId;
console.log('ROUTINE_ID=' + rid);

const rn = post(`/routines/${rid}/run-now`);
await sleep(3000);
// dump all background tasks (not activeOnly)
const all = (await get('/background-tasks')).body;
const arr = Array.isArray(all) ? all : (all.tasks || []);
console.log('ALL_TASKS_COUNT=' + arr.length);
for (const t of arr.slice(0, 8)) {
  let md = t.metadata; if (typeof md === 'string') { try { md = JSON.parse(md); } catch { md = {}; } }
  console.log('  taskId=' + t.taskId + ' status=' + t.status + ' worker=' + t.worker + ' route=' + t.route + ' routineId=' + (md?.routineId || 'none'));
}
const rnResult = await rn;
console.log('RUNNOW_STATUS=' + rnResult.status);
console.log('RUNNOW_BODY=' + JSON.stringify(rnResult.body).slice(0, 400));
process.exit(0);
