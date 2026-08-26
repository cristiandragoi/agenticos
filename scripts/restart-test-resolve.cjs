// restart-test-resolve.cjs — after a graceful restart, resolve the goal approval
// and prove the parent task auto-reconciles (no manual completion). Targets :4000.
const http = require('http');
const fs = require('fs');
const BASE = 'http://127.0.0.1:4000';
function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request(`${BASE}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {},
      timeout: 30000,
    }, (res) => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>{ try{resolve(JSON.parse(d));}catch{resolve(d);} }); });
    r.on('error', reject); r.on('timeout', () => r.destroy(new Error('timeout')));
    if (data) r.write(data); r.end();
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function main() {
  const rec = JSON.parse(fs.readFileSync('B:/AgenticOS/docs/overnight-repair/restart-recovery-ids.json', 'utf-8'));
  console.log('[resolve] ids:', JSON.stringify(rec));

  // 1. Verify the task survived the restart (still waiting_approval).
  const pre = await req('GET', `/api/background-tasks/${rec.taskId}`);
  console.log('[pre-restart-check] task status:', pre.status, '| goal:', pre.linkedRunId);
  if (pre.status !== 'waiting_approval') {
    console.log('NOTE: task not waiting_approval (may have already reconciled) — continuing to verify terminal state.');
  }

  // 2. Resolve approval via the canonical goal approval endpoint.
  const goalId = rec.goalId;
  let approve;
  try {
    approve = await req('POST', `/api/chat/agents/goal/${goalId}/approve`, { action: 'approve' });
    console.log('[approve] response:', JSON.stringify(approve).slice(0, 300));
  } catch (e) {
    console.log('[approve] error (may need alternate endpoint):', e.message);
  }

  // 3. Poll for terminal state (auto-reconciliation, no manual completion).
  let finalTask = null;
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    await sleep(5000);
    finalTask = await req('GET', `/api/background-tasks/${rec.taskId}`);
    const s = finalTask.status;
    console.log('[poll]', s, '| verificationState:', finalTask.verificationState, '| goal:', finalTask.linkedRunId);
    if (['completed', 'failed', 'blocked', 'cancelled'].includes(s)) break;
  }

  // 4. Verify goal terminal + file written + no orphan.
  let goalStatus = 'unknown';
  try { const g = await req('GET', `/api/chat/goals/${goalId}`); goalStatus = g.status; } catch {}
  const fileWritten = fs.existsSync('B:/AgenticOS/server/src/__tests__/restartRecoveryTmp.test.ts');

  const result = {
    taskId: rec.taskId,
    goalId,
    finalTaskStatus: finalTask.status,
    verificationState: finalTask.verificationState,
    goalStatus,
    fileWritten,
    resultText: (finalTask.resultText || '').slice(0, 300),
  };
  fs.writeFileSync('B:/AgenticOS/docs/overnight-repair/restart-recovery-result.json', JSON.stringify(result, null, 2));
  console.log('\n=== RESTART-RECOVERY RESULT ===');
  console.log(JSON.stringify(result, null, 2));

  const ok = finalTask.status === 'completed' && goalStatus === 'completed' && fileWritten;
  console.log(`\n=== RESOLVE+RECONCILE ${ok ? 'PASS' : 'FAIL'} ===`);
  process.exit(ok ? 0 : 2);
}
main().catch((e) => { console.error('FATAL:', e); process.exit(2); });
