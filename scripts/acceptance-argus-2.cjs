/* ARGUS LIVE ACCEPTANCE #2 — unmet requirement → defect packet → auto-correct → re-verify.
 * 1. POST goal: implement file with WRONG content (intentionally unmet contract)
 * 2. POST contract: requires CORRECT content
 * 3. First verification FAILS → structured defect packet → auto-correction goal dispatched
 * 4. Correction goal runs (repairContext injected, no manual copy) and fixes the file
 * 5. Re-verification → VERIFIED_COMPLETE
 */
const BASE = process.env.CODEX_API_BASE || 'http://127.0.0.1:4001';
const fs = require('fs');

const FILE = 'argus-live-accept2.txt';
const WRONG = 'FIRST_ATTEMPT';
const RIGHT = 'CORRECTED_BY_ARGUS';
const FULL_PATH = `B:\\AgenticOS\\${FILE}`;

(async () => {
  try { fs.unlinkSync(FULL_PATH); } catch {}

  const created = await fetch(`${BASE}/api/chat/agents/goal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      goal: `Create the file ${FILE} in the workspace root containing exactly: ${WRONG}. Do not add extra text or newlines beyond the content.`,
      workspacePath: 'B:\\AgenticOS',
      repositoryRoot: 'B:\\AgenticOS',
      approvalPolicy: 'auto',
      executionOptions: { executionProviderId: 'prov-deepseek', disableFallback: false },
    }),
  });
  const createdBody = await created.json();
  if (!created.ok || !createdBody.goalId) { console.log('ACCEPT2 CREATE FAILED', created.status, JSON.stringify(createdBody).slice(0, 400)); process.exit(1); }
  const goalId = createdBody.goalId;
  console.log(`ACCEPT2 goal ${goalId} submitted (asks for WRONG content intentionally)`);

  // Contract requires the CORRECT content — first implementation is a miss.
  const contractRes = await fetch(`${BASE}/api/argus/contracts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      goalId,
      acceptanceCriteria: [{ type: 'file-content', path: FILE, exact: RIGHT }],
      title: `LIVE ACCEPTANCE #2 — ${FILE}`,
    }),
  });
  const contractBody = await contractRes.json();
  if (!contractRes.ok || !contractBody.contract) { console.log('ACCEPT2 CONTRACT FAILED', contractRes.status, JSON.stringify(contractBody).slice(0, 400)); process.exit(1); }
  console.log(`ACCEPT2 contract ${contractBody.contract.id} created (requires ${RIGHT})`);

  const start = Date.now();
  let state = null;
  while (Date.now() - start < 300000) {
    await new Promise(r => setTimeout(r, 5000));
    const res = await fetch(`${BASE}/api/chat/agents/goal/${goalId}`);
    if (!res.ok) continue;
    const g = await res.json();
    state = g.status;
    if (['completed', 'failed', 'stopped', 'cancelled', 'paused'].includes(state)) break;
  }
  console.log(`ACCEPT2 primary goal terminal state=${state} durationMs=${Date.now() - start}`);

  // Poll for the correction cycle: verification_failed → correcting → verified_complete.
  const cycleStart = Date.now();
  let verificationState = null;
  let lastCheck = null;
  while (Date.now() - cycleStart < 300000) {
    await new Promise(r => setTimeout(r, 5000));
    const statusRes = await fetch(`${BASE}/api/argus/goals/${goalId}`);
    if (!statusRes.ok) continue;
    const body = await statusRes.json();
    verificationState = body.goal.verificationState;
    const vs = body.verifications || [];
    const latest = vs[vs.length - 1];
    const contracts = body.contracts || [];
    const contract = contracts[0] || {};
    lastCheck = {
      verificationState,
      verifications: vs.length,
      latestStatus: latest?.status,
      latestEvidence: latest?.evidenceLevel,
      contractStatus: contract.status,
      defectStatus: (body.defects ? [] : null),
    };
    if (verificationState === 'verified_complete') break;
    if (verificationState === 'verification_failed') { /* may still be mid-correction */ }
  }

  // Detail: defect packet + correction goal.
  const detailRes = await fetch(`${BASE}/api/argus/goals/${goalId}`);
  const detail = await detailRes.json();
  const defects = await (await fetch(`${BASE}/api/argus/defects`)).json();
  const myDefects = (defects.defects || []).filter((d) => d.goalId === goalId);
  const correctionGoalId = myDefects[0]?.correctionGoalId || null;

  const vs = detail.verifications || [];
  const latest = vs[0]; // goal-status endpoint returns verifications DESC (latest first)
  console.log(`ACCEPT2 verificationState=${verificationState} verifications=${vs.length} latestStatus=${latest?.status} evidence=${latest?.evidenceLevel}`);
  console.log(`ACCEPT2 contract status=${(detail.contracts[0] || {}).status}`);
  console.log(`ACCEPT2 defects=${myDefects.length} firstDefect.status=${myDefects[0]?.status} correctionGoalId=${correctionGoalId}`);
  console.log(`ACCEPT2 file content now="${fs.existsSync(FULL_PATH) ? fs.readFileSync(FULL_PATH, 'utf-8') : '(missing)'}"`);

  const correctionState = correctionGoalId ? (await fetch(`${BASE}/api/chat/agents/goal/${correctionGoalId}`).then(r => r.json())).status : null;
  console.log(`ACCEPT2 correction goal ${correctionGoalId} status=${correctionState}`);

  const ok = verificationState === 'verified_complete'
    && vs.length >= 2
    && latest?.status === 'verified_complete'
    && fs.existsSync(FULL_PATH)
    && fs.readFileSync(FULL_PATH, 'utf-8').trim() === RIGHT;
  console.log(`RESULT ${ok ? 'PASS' : 'FAIL'}`);
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
