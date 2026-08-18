// Magnitude runtime proof on the NEW deployed build: provenance (A5/M6),
// screenshot evidence (M7), and M1 regression with project scoping.
const BASE = 'http://127.0.0.1:4000';

async function createRun(body) {
  const res = await fetch(`${BASE}/api/magnitude/runs`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
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

// M6/M7/M1 with provenance: Project A run
const a = await createRun({ goal: 'inspect https://example.com', projectId: 'proj-A', projectTaskId: 'task-A', scheduleExecutionId: 'sched-A' });
let aDone = null;
if (a.body?.id) aDone = await waitTerminal(a.body.id);
console.log('A_RUN', JSON.stringify({ id: aDone?.id, status: aDone?.status, projectId: aDone?.projectId, projectTaskId: aDone?.projectTaskId, scheduleExecutionId: aDone?.scheduleExecutionId }));
console.log('A_RESULT', JSON.stringify({ title: aDone?.result?.title, screenshotPath: aDone?.result?.screenshotPath, screenshotBytes: aDone?.result?.screenshotBytes }));

// Project B run — same URL, different project
const b = await createRun({ goal: 'inspect https://example.com', projectId: 'proj-B' });
let bDone = null;
if (b.body?.id) bDone = await waitTerminal(b.body.id);
console.log('B_RUN', JSON.stringify({ id: bDone?.id, status: bDone?.status, projectId: bDone?.projectId }));

// M6 bidirectional: project-scoped listing
const onlyA = await (await fetch(`${BASE}/api/magnitude/runs?projectId=proj-A`)).json();
const onlyB = await (await fetch(`${BASE}/api/magnitude/runs?projectId=proj-B`)).json();
console.log('M6_ISOLATION', JSON.stringify({
  A_hasOwn: onlyA.some((r) => r.id === aDone?.id),
  A_leaksB: onlyA.some((r) => r.id === bDone?.id),
  B_hasOwn: onlyB.some((r) => r.id === bDone?.id),
  B_leaksA: onlyB.some((r) => r.id === aDone?.id),
}));

// M7: screenshot endpoint serves the run's evidence
if (aDone?.result?.screenshotPath) {
  const shot = await fetch(`${BASE}/api/magnitude/runs/${aDone.id}/screenshot`);
  const buf = await shot.arrayBuffer();
  console.log('M7_SCREENSHOT', JSON.stringify({ status: shot.status, contentType: shot.headers.get('content-type'), bytes: buf.byteLength, png: buf.byteLength > 8 && new Uint8Array(buf.slice(0, 8))[1] === 0x50 }));
  // The screenshot file must live under the project's dir (project ownership).
  console.log('M7_OWNERSHIP', JSON.stringify({ underProjectA: String(aDone.result.screenshotPath).includes('proj-A') }));
}
