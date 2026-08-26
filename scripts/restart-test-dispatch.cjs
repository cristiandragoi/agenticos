// restart-test-dispatch.cjs — dispatch a mutating CodeX task (manual approval),
// wait for waiting_approval, record IDs. Targets the packaged production :4000.
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
async function main() {
  const task = await req('POST', '/api/background-tasks', {
    title: 'RESTART_RECOVERY_TMP — approval/restart reconciliation test',
    objective: 'Create a file server/src/__tests__/restartRecoveryTmp.test.ts containing a trivial passing vitest test (describe/it asserting expect(true).toBe(true)), run it with npx vitest run server/src/__tests__/restartRecoveryTmp.test.ts, then finish with a one-line confirmation of the pass/fail result.',
    worker: 'codex',
    workspacePath: 'B:\\AgenticOS',
  });
  const taskId = task.taskId || task.id;
  console.log('[dispatch] taskId=', taskId);
  if (!taskId) { console.error('NO TASK ID:', JSON.stringify(task).slice(0, 400)); process.exit(2); }
  const deadline = Date.now() + 120000;
  let st = task;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    st = await req('GET', `/api/background-tasks/${taskId}`);
    const s = st.status || st.state;
    console.log('[poll]', s, '| goal=', st.linkedRunId || st.goalId);
    if (s === 'waiting_approval') break;
    if (['completed', 'failed', 'cancelled', 'blocked'].includes(s)) {
      console.error('Unexpected terminal state before approval:', s, JSON.stringify(st).slice(0,300));
      process.exit(2);
    }
  }
  const goalId = st.linkedRunId || st.goalId;
  const rec = { taskId, goalId, approvalState: st.approvalState, status: st.status, createdAt: new Date().toISOString() };
  fs.writeFileSync('B:/AgenticOS/docs/overnight-repair/restart-recovery-ids.json', JSON.stringify(rec, null, 2));
  console.log('\n=== RESTART-RECOVERY IDs ===');
  console.log(JSON.stringify(rec, null, 2));
  const ok = st.status === 'waiting_approval' && goalId;
  console.log(`\n=== DISPATCH ${ok ? 'READY (waiting_approval)' : 'FAIL'} ===`);
  process.exit(ok ? 0 : 2);
}
main().catch((e) => { console.error('FATAL:', e); process.exit(2); });
