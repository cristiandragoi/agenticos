// TEST 3 + TEST 4: seed research/constraint/debug + project A/B isolation, then
// drive a Hermes research task under Project A and verify retrieval + isolation.
const API = 'http://127.0.0.1:4000/api';
const PROJ_A = 'proj-d95123d8';

async function main() {
  // Seed: verified research + project constraint + engineering debug (all in PROJ_A)
  const seeds = [
    { type: 'semantic', title: 'Verified market research: primary market is Germany', content: 'Verified research: the primary customer market is Germany (DACH region).', tags: ['research', 'verified', 'market'] },
    { type: 'decision', title: 'Project constraint: no cold outreach', content: 'Constraint: no automated outreach without human approval.', tags: ['constraint', 'outreach', 'decision'] },
    { type: 'episodic', title: 'Engineering debug: stacktrace build 42', content: 'Raw engineering debug stacktrace from build 42.', tags: ['engineering-debug', 'debug'] },
  ];
  for (const s of seeds) {
    const r = await fetch(`${API}/memory/memories`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...s, scope: `project:${PROJ_A}`, human: true, entities: [PROJ_A] }),
      signal: AbortSignal.timeout(8000),
    });
    const j = await r.json();
    console.log('SEEDED', s.title, '->', j.id, j.verificationStatus);
  }

  // Seed Project B (isolation): Spain market.
  const pb = await fetch(`${API}/projects`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Project B Isolation', status: 'active' }),
    signal: AbortSignal.timeout(8000),
  });
  const pbj = await pb.json();
  const PROJ_B = pbj.id || 'proj-b-isolation';
  console.log('PROJECT B', PROJ_B);
  await fetch(`${API}/memory/memories`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'semantic', title: 'Customer market = Spain', content: 'The customer market for Project B is Spain.', tags: ['market', 'research'], scope: `project:${PROJ_B}`, human: true, entities: [PROJ_B] }),
    signal: AbortSignal.timeout(8000),
  });
  console.log('SEEDED Project B: Spain market');

  // Set PROJ_A active, drive Hermes research.
  await fetch(`${API}/projects/active`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId: PROJ_A }), signal: AbortSignal.timeout(5000),
  });
  const cr = await fetch(`${API}/jarvis/conversations`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Proof Hermes Retrieval' }), signal: AbortSignal.timeout(5000),
  });
  const conv = await cr.json();
  const prompt = 'use hermes to research the customer market and project constraints for this project, and produce verified durable facts.';
  const opId = `memproof-hermes3-${Date.now()}`;
  const mr = await fetch(`${API}/jarvis/conversations/${conv.id}/message`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, approvalPolicy: 'auto', operationId: opId }),
    signal: AbortSignal.timeout(150000),
  });
  const mres = await mr.json().catch(() => ({}));
  console.log('HERMES RESULT', JSON.stringify(mres).slice(0, 800));
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
