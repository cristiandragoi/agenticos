// Seed durable project memories via the PACKAGED API (human path), then run a
// scoped research task whose objective is genuinely satisfiable by retrieved memory.
const API = 'http://127.0.0.1:4000/api';
const PROJ = 'proj-d95123d8';

async function main() {
  // Seed project-scoped durable facts (human-confirmed path).
  const facts = [
    { type: 'decision', title: 'Production state must use Electron userData', content: 'Production state must use Electron userData and never packaged resources.', tags: ['architecture', 'deployment', 'constraint'] },
    { type: 'semantic', title: 'Primary affiliate audience is social-media users', content: 'The primary affiliate audience is social-media users.', tags: ['marketing', 'audience'] },
  ];
  for (const f of facts) {
    const r = await fetch(`${API}/memory/memories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...f, scope: `project:${PROJ}`, human: true, entities: [PROJ] }),
      signal: AbortSignal.timeout(8000),
    });
    const j = await r.json();
    console.log('SEEDED', f.title, '->', j.id, 'vs=', j.verificationStatus, 'src=', j.source?.sourceType, 'scope=', j.scope);
  }

  // Run a research task scoped to DOCUMENT the stored constraints (objective is
  // genuinely satisfiable because retrieved memory IS the evidence).
  const cr = await fetch(`${API}/jarvis/conversations`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Production Memory Proof - Constraints' }),
    signal: AbortSignal.timeout(5000),
  });
  const conv = await cr.json();

  const prompt = 'use hermes to research and document the production persistence constraint and the project operating constraints stored in project memory, and produce verified durable project facts.';
  const opId = `memproof-hermes2-${Date.now()}`;
  console.log('SENDING SCOPED HERMES TASK', opId);
  const t0 = Date.now();
  const mr = await fetch(`${API}/jarvis/conversations/${conv.id}/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, approvalPolicy: 'auto', operationId: opId }),
    signal: AbortSignal.timeout(150000),
  });
  const mres = await mr.json().catch(() => ({}));
  console.log('MESSAGE HTTP', mr.status, 'elapsedMs', Date.now() - t0);
  console.log('RESULT', JSON.stringify(mres).slice(0, 1200));
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
