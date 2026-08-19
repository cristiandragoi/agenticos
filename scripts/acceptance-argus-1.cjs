/* ARGUS LIVE ACCEPTANCE #1 — implementation → ARGUS → VERIFIED_COMPLETE.
 * Drives the canonical goal path on the dev backend (:4001):
 * 1. POST /api/chat/agents/goal  (Codex implements a real file)
 * 2. POST /api/argus/contracts   (immutable contract with file-content check)
 * 3. Wait for goal completion → onGoalCompleted hook fires ARGUS verification
 * 4. Assert goal.verificationState === 'verified_complete' + verification record
 */
const BASE = process.env.CODEX_API_BASE || 'http://127.0.0.1:4001';
const fs = require('fs');

const FILE = 'argus-live-accept1.txt';
const CONTENT = 'ARGUS_ACCEPTANCE_1_OK';
const FULL_PATH = `B:\\AgenticOS\\${FILE}`;

(async () => {
  // 0. Clean any prior artifact (acceptance must prove the executor created it).
  try { fs.unlinkSync(FULL_PATH); } catch {}

  // 1. Create the implementation goal through the canonical path.
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
  if (!created.ok || !createdBody.goalId) {
    console.log('ACCEPT1 CREATE FAILED', created.status, JSON.stringify(createdBody).slice(0, 400));
    process.exit(1);
  }
  const goalId = createdBody.goalId;
  console.log(`ACCEPT1 goal ${goalId} submitted`);

  // 2. Create the ARGUS contract immediately (snapshots original spec).
  const contractRes = await fetch(`${BASE}/api/argus/contracts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      goalId,
      acceptanceCriteria: [
        { type: 'file-content', path: FILE, exact: CONTENT },
      ],
      title: `LIVE ACCEPTANCE #1 — ${FILE}`,
    }),
  });
  const contractBody = await contractRes.json();
  if (!contractRes.ok || !contractBody.contract) {
    console.log('ACCEPT1 CONTRACT FAILED', contractRes.status, JSON.stringify(contractBody).slice(0, 400));
    process.exit(1);
  }
  const contract = contractBody.contract;
  console.log(`ACCEPT1 contract ${contract.id} created (status ${contract.status}, specHash ${contract.specHash.slice(0, 12)})`);

  // 3. Poll to terminal goal state, then let the ARGUS hook settle.
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
  console.log(`ACCEPT1 goal terminal state=${state} durationMs=${Date.now() - start}`);
  if (state !== 'completed') { console.log('ACCEPT1 FAIL: goal did not complete'); process.exit(1); }

  // 4. Assert ARGUS auto-verified.
  await new Promise(r => setTimeout(r, 3000)); // let the async hook finish
  const statusRes = await fetch(`${BASE}/api/argus/goals/${goalId}`);
  const statusBody = await statusRes.json();
  const vs = statusBody.verifications || [];
  const latest = vs[vs.length - 1];
  console.log(`ACCEPT1 verificationState=${statusBody.goal.verificationState} verifications=${vs.length}`);
  console.log(`ACCEPT1 latest verification: status=${latest?.status} evidenceLevel=${latest?.evidenceLevel}`);
  console.log(`ACCEPT1 verdict.passed=${latest?.verdict?.passed} summary=${(latest?.verdict?.summary || '').slice(0, 120)}`);
  console.log(`ACCEPT1 contract status=${(statusBody.contracts[0] || {}).status}`);

  const ok = statusBody.goal.verificationState === 'verified_complete'
    && latest?.status === 'verified_complete'
    && latest?.verdict?.passed === true
    && fs.existsSync(FULL_PATH);
  console.log(`RESULT ${ok ? 'PASS' : 'FAIL'}`);
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
