// A2 probes continued: M2 terminal, M3 timeout, M4 cancel, M5 rerun.
const BASE = 'http://127.0.0.1:4000';

async function createRun(goal, actionType = 'inspect') {
  const res = await fetch(`${BASE}/api/magnitude/runs`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ goal, actionType }),
  });
  return { status: res.status, body: await res.json() };
}
async function getRun(id) {
  const res = await fetch(`${BASE}/api/magnitude/runs/${id}`);
  return res.ok ? await res.json() : { error: res.statusText };
}
async function waitTerminal(id, timeoutMs = 40000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const r = await getRun(id);
    if (['completed', 'failed', 'stopped'].includes(r.status)) return r;
    await new Promise((r2) => setTimeout(r2, 500));
  }
  return { id, status: 'TIMEOUT' };
}

// M2 terminal state (invalid URL → should be failed with truthful error)
const m2 = await createRun('this is not a url');
let m2done = null;
if (m2.body?.id) m2done = await waitTerminal(m2.body.id);
console.log('M2_TERMINAL', JSON.stringify({ id: m2done?.id, status: m2done?.status, error: m2done?.error }));

// M3: navigation timeout — use a non-routable IP (10.255.255.1) to force timeout-ish failure
const m3 = await createRun('http://10.255.255.1:81/');
let m3done = null;
if (m3.body?.id) m3done = await waitTerminal(m3.body.id, 45000);
console.log('M3_TERMINAL', JSON.stringify({ id: m3done?.id, status: m3done?.status, error: m3done?.error?.slice(0, 120) }));

// M4: cancel an active run — use slow host so run stays alive
const m4 = await createRun('http://10.255.255.2:82/');
if (m4.body?.id) {
  await new Promise((r) => setTimeout(r, 1500));
  const stop = await fetch(`${BASE}/api/magnitude/runs/${m4.body.id}/stop`, { method: 'POST' });
  const stopBody = await stop.json();
  console.log('M4_STOP', JSON.stringify(stopBody));
  const m4done = await getRun(m4.body.id);
  console.log('M4_TERMINAL', JSON.stringify({ id: m4done?.id, status: m4done?.status, error: m4done?.error }));
}

// M5: rerun after cancellation — example.com again
const m5 = await createRun('https://example.com');
let m5done = null;
if (m5.body?.id) m5done = await waitTerminal(m5.body.id);
console.log('M5_RERUN', JSON.stringify({ id: m5done?.id, status: m5done?.status, title: m5done?.result?.title }));
