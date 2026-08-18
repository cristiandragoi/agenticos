// TEST 1 driver: drive the PACKAGED runtime's real Hermes flow to prove the
// promotion chain conversationId → projectId → goalId → taskId → runId →
// resultId → verificationId → candidateId → memoryId.
const API = 'http://127.0.0.1:4000/api';

async function main() {
  // 1. Create a real project (or reuse existing) and set active.
  let projectId = null;
  try {
    const pr = await fetch(`${API}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Production Memory Proof', description: 'Runtime proof of Project Memory promotion chain', status: 'active', tags: ['memory-proof'] }),
      signal: AbortSignal.timeout(8000),
    });
    const pj = await pr.json();
    projectId = pj.id || pj.project?.id;
    console.log('PROJECT', pr.status, JSON.stringify(pj).slice(0, 200));
  } catch (e) { console.log('project create err', String(e).slice(0, 150)); }

  if (!projectId) {
    // fall back to an existing project
    const pr = await fetch(`${API}/projects`, { signal: AbortSignal.timeout(5000) });
    const arr = await pr.json();
    const list = Array.isArray(arr) ? arr : (arr.projects || []);
    projectId = list[0]?.id || 'proj-c11cfe54';
    console.log('FALLBACK PROJECT', projectId);
  }

  // Set active project
  await fetch(`${API}/projects/active`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId }),
    signal: AbortSignal.timeout(5000),
  });
  console.log('ACTIVE PROJECT SET', projectId);

  // 2. Create a conversation
  const cr = await fetch(`${API}/jarvis/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Production Memory Proof' }),
    signal: AbortSignal.timeout(5000),
  });
  const conv = await cr.json();
  const conversationId = conv.id;
  console.log('CONVERSATION', conversationId);

  // 3. Send a Hermes research task (no URL, so it does not depend on Magnitude).
  const prompt = 'use hermes to research the primary target market for Agentic OS and produce verified durable project facts about the market and any project constraints.';
  const opId = `memproof-hermes-${Date.now()}`;
  console.log('SENDING HERMES TASK...', opId);
  const t0 = Date.now();
  const mr = await fetch(`${API}/jarvis/conversations/${conversationId}/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, approvalPolicy: 'auto', operationId: opId }),
    signal: AbortSignal.timeout(150000),
  });
  const mresult = await mr.json().catch(() => ({}));
  console.log('MESSAGE HTTP', mr.status, 'elapsedMs', Date.now() - t0);
  console.log('MESSAGE RESULT', JSON.stringify(mresult).slice(0, 1500));
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
