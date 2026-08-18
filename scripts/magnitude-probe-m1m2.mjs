// A2 capability probes — live Magnitude runtime (deployed backend :4000).
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
async function waitTerminal(id, timeoutMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const r = await getRun(id);
    if (['completed', 'failed', 'stopped'].includes(r.status)) return r;
    await new Promise((r2) => setTimeout(r2, 500));
  }
  return { id, status: 'TIMEOUT' };
}

// M1: open example.com
const m1 = await createRun('https://example.com');
let m1done = null;
if (m1.body?.id) m1done = await waitTerminal(m1.body.id);
console.log('M1_CREATE', m1.status, m1.body?.id, m1.body?.status || m1.body?.error);
console.log('M1_RESULT', JSON.stringify({ id: m1done?.id, status: m1done?.status, title: m1done?.result?.title, finalUrl: m1done?.result?.finalUrl, error: m1done?.error }));

// M2: invalid URL
const m2 = await createRun('not a url at all');
console.log('M2_CREATE', m2.status, JSON.stringify(m2.body));
