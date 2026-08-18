// TEST 2 driver: read-only CodeX engineering task → verify CODEX memory retrieval
// in packaged runtime (engineering fact retrieved, marketing excluded, IDs persisted).
const API = 'http://127.0.0.1:4000/api';
const PROJ = 'proj-d95123d8';

async function main() {
  // Ensure active project
  await fetch(`${API}/projects/active`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId: PROJ }), signal: AbortSignal.timeout(5000),
  });

  const cr = await fetch(`${API}/jarvis/conversations`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Production Memory Proof - CodeX' }),
    signal: AbortSignal.timeout(5000),
  });
  const conv = await cr.json();

  // Read-only engineering task about production persistence (auto-detected read-only).
  const prompt = 'read-only: inspect the server source and report how production state persistence is configured — specifically confirm whether it uses Electron userData or packaged resources.';
  const opId = `memproof-codex-${Date.now()}`;
  console.log('SENDING CODEX TASK', opId, 'conv', conv.id);
  const t0 = Date.now();
  const mr = await fetch(`${API}/jarvis/conversations/${conv.id}/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, approvalPolicy: 'auto', operationId: opId, workspacePath: 'B:/AgenticOS' }),
    signal: AbortSignal.timeout(150000),
  });
  const mres = await mr.json().catch(() => ({}));
  console.log('MESSAGE HTTP', mr.status, 'elapsedMs', Date.now() - t0);
  console.log('RESULT', JSON.stringify(mres).slice(0, 1200));
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
