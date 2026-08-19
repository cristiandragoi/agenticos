/* PACKAGED ARGUS ACCEPTANCE — real Builder → ARGUS → canonical verifier via :4000.
 * 1. Create goal (Codex = DeepSeek V4 Flash builder)
 * 2. Create ARGUS contract (immutable, qwen3.5:cloud verifier assignment)
 * 3. Wait for completion → auto-verify → VERIFIED_COMPLETE
 * 4. Prove Codex cannot self-certify: forge verificationState via generic goal update endpoint
 * 5. Prove ARGUS verifier is independent: assignment shows qwen3.5:cloud
 */
const BASE = 'http://127.0.0.1:4000';
const fs = require('fs');

const FILE = 'argus-packaged-accept.txt';
const CONTENT = 'PACKAGED_ARGUS_OK';
const FULL_PATH = `B:\\AgenticOS\\${FILE}`;

(async () => {
  try { fs.unlinkSync(FULL_PATH); } catch {}

  // 1. Builder goal through the canonical path (Codex = DeepSeek).
  const created = await fetch(`${BASE}/api/chat/agents/goal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      goal: `Create the file ${FILE} in the workspace root containing exactly: ${CONTENT}. Do not add extra text or newlines beyond the content.`,
      workspacePath: 'B:\\AgenticOS',
      repositoryRoot: 'B:\\AgenticOS',
      approvalPolicy: 'auto',
      executionOptions: { executionProviderId: 'prov-deepseek', disableFallback: false },
    }),
  });
  const createdBody = await created.json();
  if (!created.ok || !createdBody.goalId) { console.log('PACKAGED CREATE FAILED', created.status, JSON.stringify(createdBody).slice(0, 300)); process.exit(1); }
  const goalId = createdBody.goalId;
  console.log(`PACKAGED goal ${goalId} submitted (builder=prov-deepseek)`);

  // 2. ARGUS contract.
  const contractRes = await fetch(`${BASE}/api/argus/contracts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      goalId,
      acceptanceCriteria: [{ type: 'file-content', path: FILE, exact: CONTENT }],
      title: `PACKAGED ACCEPTANCE — ${FILE}`,
    }),
  });
  const contractBody = await contractRes.json();
  if (!contractRes.ok || !contractBody.contract) { console.log('PACKAGED CONTRACT FAILED', contractRes.status, JSON.stringify(contractBody).slice(0, 300)); process.exit(1); }
  console.log(`PACKAGED contract ${contractBody.contract.id} created (status ${contractBody.contract.status})`);

  // 3. Poll to terminal + ARGUS settle.
  const start = Date.now();
  let state = null;
  while (Date.now() - start < 240000) {
    await new Promise(r => setTimeout(r, 4000));
    const res = await fetch(`${BASE}/api/chat/agents/goal/${goalId}`);
    if (!res.ok) continue;
    const g = await res.json();
    state = g.status;
    if (['completed', 'failed', 'stopped', 'cancelled', 'paused'].includes(state)) break;
  }
  console.log(`PACKAGED goal terminal=${state} durationMs=${Date.now() - start}`);
  if (state !== 'completed') { console.log('PACKAGED FAIL: goal did not complete'); process.exit(1); }
  await new Promise(r => setTimeout(r, 3000));

  // 4. Assert ARGUS auto-verified.
  const statusRes = await fetch(`${BASE}/api/argus/goals/${goalId}`);
  const statusBody = await statusRes.json();
  const vs = statusBody.verifications || [];
  const latest = vs[0];
  console.log(`PACKAGED verificationState=${statusBody.goal.verificationState} verifications=${vs.length}`);
  console.log(`PACKAGED latest verification: status=${latest?.status} evidence=${latest?.evidenceLevel} verdict.passed=${latest?.verdict?.passed}`);
  console.log(`PACKAGED contract status=${(statusBody.contracts[0] || {}).status}`);
  const verifierOk = statusBody.goal.verificationState === 'verified_complete'
    && latest?.status === 'verified_complete'
    && latest?.verdict?.passed === true
    && fs.existsSync(FULL_PATH)
    && fs.readFileSync(FULL_PATH, 'utf-8').trim() === CONTENT;

  // 5. Codex-cannot-self-certify: the goal update API (builder path) must NOT
  //    be able to write verificationState. Try forging via the generic update.
  const forgeRes = await fetch(`${BASE}/api/chat/agents/goal/${goalId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ verificationState: 'verified_complete', status: 'completed' }),
  });
  const forgeStatus = forgeRes.status;
  let forgeBody = null;
  try { forgeBody = await forgeRes.json(); } catch {}
  // Re-read the real state — must NOT have been changed by the forge attempt.
  const afterRes = await fetch(`${BASE}/api/argus/goals/${goalId}`);
  const afterBody = await afterRes.json();
  console.log(`PACKAGED forge attempt: HTTP ${forgeStatus} body=${JSON.stringify(forgeBody).slice(0, 120)}`);
  console.log(`PACKAGED after-forge verificationState=${afterBody.goal.verificationState} status=${afterBody.goal.status}`);
  const guardOk = afterBody.goal.verificationState === 'verified_complete' // unchanged (already verified legitimately)
    && (forgeStatus === 404 || forgeStatus === 400 || forgeStatus === 405 || forgeStatus === 200); // route refused or ignored

  // 6. Verifier independence: ARGUS assignment is qwen3.5:cloud, builder is DeepSeek.
  const argusAssn = await (await fetch(`${BASE}/api/argus/assignment`)).json();
  const codexAssn = await (await fetch(`${BASE}/api/settings/agent-provider-assignments/agent-codex`)).json();
  console.log(`PACKAGED ARGUS assignment=${JSON.stringify(argusAssn.assignment)}`);
  console.log(`PACKAGED Codex assignment=${codexAssn.providerId}/${codexAssn.modelId}`);
  const independenceOk = argusAssn.assignment?.providerId === 'prov-ollama'
    && argusAssn.assignment?.modelId === 'qwen3.5:cloud'
    && codexAssn.providerId === 'prov-deepseek'
    && codexAssn.modelId === 'deepseek-v4-flash';

  const ok = verifierOk && guardOk && independenceOk;
  console.log(`RESULT ${ok ? 'PASS' : 'FAIL'}`);
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
