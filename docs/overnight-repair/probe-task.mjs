const BASE = 'http://127.0.0.1:4002';
async function j(p) { const r = await fetch(`${BASE}${p}`); return { s: r.status, d: await r.json().catch(() => null) }; }
const task = await j('/api/background-tasks/bgtask-1ff33279e');
console.log('TASK:', JSON.stringify({ status: task.d?.status, stage: task.d?.currentStage, linkedRunId: task.d?.linkedRunId, progress: task.d?.progressMessage, lastError: task.d?.lastError }, null, 2));
const runs = await j('/api/hermes-api/runs');
console.log('RUNS:', JSON.stringify((runs.d || []).map(r => ({ id: r.id, status: r.status, model: r.model, events: (r.events || []).length })), null, 2));
