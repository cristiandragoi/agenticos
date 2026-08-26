// phase4b-resolve.cjs — Phase 4 step 2 (run AFTER backend restart): resolve the approval,
// wait for CodeX completion, and verify the parent task auto-reconciles (no manual fix).
const http = require('http');
const fs = require('fs');
const Database = require('B:/AgenticOS/server/node_modules/better-sqlite3');

const BASE = 'http://127.0.0.1:4001';
const DEV_DB = 'C:/Users/Cris/AppData/Local/Temp/agenticos-devtest/agentic-os.db';

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request(`${BASE}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {},
      timeout: 30000,
    }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(d); } });
    });
    r.on('error', reject);
    r.on('timeout', () => r.destroy(new Error('request timeout')));
    if (data) r.write(data);
    r.end();
  });
}

async function main() {
  const ids = JSON.parse(fs.readFileSync('B:/AgenticOS/docs/overnight-repair/phase4-ids.json', 'utf-8'));
  const { taskId, goalId } = ids;
  console.log('=== PHASE4B resolve approval ===');
  console.log('taskId=', taskId, 'goalId=', goalId);

  // 1. Confirm the goal survived the restart (still waiting_for_approval).
  const db = new Database(DEV_DB, { readonly: true });
  const goalBefore = db.prepare('SELECT id, status FROM goals WHERE id = ?').get(goalId);
  console.log('[pre] goal status =', goalBefore && goalBefore.status);

  // 2. Resolve the approval via the normal API.
  const resolve = await req('POST', `/api/background-tasks/${taskId}/approval`, { choice: 'allow' });
  console.log('[resolve]', JSON.stringify(resolve).slice(0, 200));

  // 3. Poll the task to completion (the re-attached bridge should drive it).
  const deadline = Date.now() + 300000;
  let st = resolve;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5000));
    st = await req('GET', `/api/background-tasks/${taskId}`);
    const s = st.status || st.state;
    console.log('[poll]', s);
    if (['completed', 'failed', 'cancelled', 'blocked'].includes(s)) break;
  }

  // 4. Re-query the goal + task + orphan state.
  const goalAfter = db.prepare('SELECT id, status FROM goals WHERE id = ?').get(goalId);
  const orphanGoals = db.prepare("SELECT COUNT(*) c FROM goals WHERE status IN ('running','executing','waiting_for_approval','planning','queued')").get().c;
  const orphanTasks = db.prepare("SELECT COUNT(*) c FROM background_tasks WHERE status IN ('running','planning','waiting_approval','queued','dispatching')").get().c;
  const goalEventCount = db.prepare('SELECT COUNT(*) c FROM goal_events WHERE goal_id = ? AND event_type = ?').get(goalId, 'agent_completed').c;
  db.close();

  const tmpExists = fs.existsSync('B:/AgenticOS/server/src/__tests__/phase4ApprovalTmp.test.ts');

  const checks = {
    goalSurvivedRestart: goalBefore && goalBefore.status === 'waiting_for_approval',
    taskCompleted: st.status === 'completed',
    goalCompleted: goalAfter && goalAfter.status === 'completed',
    autoReconciled: st.status === 'completed' && goalAfter && goalAfter.status === 'completed',
    noOrphanGoals: orphanGoals === 0,
    noOrphanTasks: orphanTasks === 0,
    noDuplicateCompletion: goalEventCount <= 1,
    codexActuallyRan: tmpExists, // goal created its temp file after approval
  };

  console.log('\n=== PHASE4B RESULT ===');
  console.log('task status:', st.status, '| goal status:', goalAfter && goalAfter.status);
  console.log('orphan goals (running/queued/waiting):', orphanGoals);
  console.log('orphan tasks (running/queued/waiting):', orphanTasks);
  console.log('agent_completed events:', goalEventCount);
  console.log('temp file exists (codex ran):', tmpExists);
  console.log(JSON.stringify(checks, null, 2));

  const failures = Object.entries(checks).filter(([, v]) => v !== true);
  const pass = failures.length === 0;
  console.log(`\n=== PHASE4 ${pass ? 'PASS' : 'FAIL'} === (failures: ${failures.map(f => f[0]).join(', ') || 'none'})`);

  // Cleanup the temp file CodeX created (it's a test artifact).
  if (tmpExists) fs.unlinkSync('B:/AgenticOS/server/src/__tests__/phase4ApprovalTmp.test.ts');
  process.exit(pass ? 0 : 2);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(2); });
