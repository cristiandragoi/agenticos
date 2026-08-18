// Prove runtime-state transitions with real tasks.
const BASE = 'http://127.0.0.1:4600';
const j = async (path, opts) => {
  const res = await fetch(BASE + path, opts);
  let body = null; try { body = await res.json(); } catch {}
  return { status: res.status, body };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Baseline: stale task present → idle (truth fix).
const idle = await j('/api/jarvis/runtime-state');
console.log('BASELINE', JSON.stringify({ state: idle.body?.state, pending: idle.body?.pendingTaskCount }));

// Fresh queued task → delegated.
const fresh = await j('/api/background-tasks', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: 'Fresh delegated proof', objective: 'prove delegated state', worker: 'research', dispatch: false }),
});
const freshId = fresh.body?.taskId;
await sleep(300);
const duringFresh = await j('/api/jarvis/runtime-state');
console.log('FRESH_QUEUED', JSON.stringify({ task: freshId, state: duringFresh.body?.state, pending: duringFresh.body?.pendingTaskCount }));

// Cancel it → back to idle.
await j('/api/background-tasks/' + freshId + '/cancel', { method: 'POST' });
await sleep(300);
const afterCancel = await j('/api/jarvis/runtime-state');
console.log('AFTER_CANCEL', JSON.stringify({ state: afterCancel.body?.state, pending: afterCancel.body?.pendingTaskCount }));

// Now safely resolve the stale test task.
const stale = await j('/api/background-tasks/bgtask-94bd90c9f/cancel', { method: 'POST' });
console.log('STALE_RESOLVED', JSON.stringify({ status: stale.status, body: stale.body }));
const final = await j('/api/jarvis/runtime-state');
console.log('FINAL', JSON.stringify({ state: final.body?.state, pending: final.body?.pendingTaskCount }));
