// Fire a run-now for a hermes routine and dump ALL background tasks + their metadata shape.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Database = require('B:/AgenticOS/server/node_modules/better-sqlite3');
const API = 'http://127.0.0.1:4000/api';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function post(path, body) { const r = await fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }); return { status: r.status, body: await r.json().catch(() => ({})) }; }
async function get(path) { const r = await fetch(API + path); return { status: r.status, body: await r.json().catch(() => ({})) }; }

const proj = await post('/projects', { name: `DiagJ ${Date.now()}` });
const projectId = proj.body.id;
const routine = await post('/routines', { projectId, name: 'DiagJ', objective: 'Write a detailed report on TypeScript generics, variance, and conditional types with examples.', worker: 'hermes', taskTemplate: { objective: 'Detailed TypeScript generics report.', worker: 'hermes', input: { mode: 'research' } }, cronExpression: '*/30 * * * *', timezone: 'UTC', timeoutSeconds: 600 });
const rid = routine.body.routineId;
console.log('ROUTINE_ID=' + rid);

// fire-and-forget run-now
const rn = post(`/routines/${rid}/run-now`);
console.log('run-now fired (async)');

for (let i = 0; i < 15; i++) {
  await sleep(1000);
  const tasks = (await get('/background-tasks?activeOnly=true')).body;
  const arr = Array.isArray(tasks) ? tasks : (tasks.tasks || []);
  const found = arr.find(t => {
    let md = t.metadata;
    if (typeof md === 'string') { try { md = JSON.parse(md); } catch { md = {}; } }
    return md && md.routineId === rid;
  });
  if (found) {
    console.log('FOUND at i=' + i);
    console.log('taskId=' + found.taskId, 'status=' + found.status, 'worker=' + found.worker, 'route=' + found.route);
    console.log('metadata=' + JSON.stringify(found.metadata));
    break;
  }
  if (i === 14) {
    console.log('NOT FOUND after 15s. Dumping all active tasks:');
    for (const t of arr) console.log('  ', t.taskId, t.status, t.worker, t.route, JSON.stringify(t.metadata));
  }
}
process.exit(0);
