// Test A (clean) — create project + Hermes routine, wait for natural fire,
// then poll to terminal completion and dump the full canonical chain.
const API = 'http://127.0.0.1:4000/api';

async function post(path, body) {
  const r = await fetch(`${API}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

const proj = await post('/projects', { name: `Hermes Smoke A ${Date.now()}`, tags: ['acceptance'] });
const projectId = proj.body.id;
const routine = await post('/routines', {
  projectId,
  name: 'Hermes Scheduled Smoke Test A',
  objective: 'Return a concise research note explaining what example.com is. Do not browse; answer from general knowledge.',
  worker: 'hermes',
  cronExpression: '* * * * *',
  enabled: true,
  verificationPolicy: 'required',
});
console.log('PROJECT_ID=' + projectId);
console.log('ROUTINE_ID=' + routine.body.routineId);
console.log('SCHEDULE_ID=' + routine.body.scheduleId);
