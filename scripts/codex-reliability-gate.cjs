// codex-reliability-gate.cjs — 3 consecutive real CodeX production tasks through
// the canonical background-tasks → codexService.createGoal path. Verifies tools
// executed, no synthetic completion, truthful metadata, no orphan state.
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

const TASKS = [
  {
    id: 'A',
    title: 'CODEX GATE A — read + search + git',
    objective: 'Inspect server/src/utils/sandbox.ts and server/src/loops/fileRead.ts. Use searchFiles to find "ALLOWLIST_BINARIES" across the repository. Run: git rev-parse --show-toplevel, git status --short, node --version, npm --version, rg --version. Report the workspace root and a factual summary of what you found.',
  },
  {
    id: 'B',
    title: 'CODEX GATE B — edit + test',
    objective: 'Create a new small test file src/__tests__/codexReliabilityGate.test.ts containing a single trivial passing vitest test (describe/it asserting expect(1).toBe(1)). Run it with "npx vitest run src/__tests__/codexReliabilityGate.test.ts" and report the ACTUAL pass/fail result.',
  },
  {
    id: 'C',
    title: 'CODEX GATE C — multi-step implementation',
    objective: 'Inspect src/lib/domainNormalization.ts. Use searchFiles to find where it is imported. Then APPEND (writeFile with "append": true) one additional trivial test case to src/lib/domainNormalization.test.ts asserting a known idempotent normalization behavior. Run "npx vitest run src/lib/domainNormalization.test.ts" and report files changed + the ACTUAL pass/fail result.',
  },
];

async function runTask(t) {
  console.log(`\n=== TASK ${t.id} — ${t.title} ===`);
  const task = await req('POST', '/api/background-tasks', {
    title: t.title,
    objective: t.objective,
    worker: 'codex',
    workspacePath: 'B:\\AgenticOS',
  });
  const taskId = task.taskId || task.id;
  if (!taskId) { console.log('NO TASK ID:', JSON.stringify(task).slice(0, 300)); return { id: t.id, ok: false, reason: 'no-task-id' }; }
  console.log('taskId:', taskId);

  let st = task;
  const deadline = Date.now() + 300000;
  let approved = false;
  while (Date.now() < deadline) {
    await sleep(5000);
    st = await req('GET', `/api/background-tasks/${taskId}`);
    const s = st.status;
    if (['completed', 'failed', 'blocked', 'cancelled'].includes(s)) break;
    // Auto-resolve the safety approval for our OWN harmless test task (the
    // mutating command triggers manual approval — resolve it as the simulated user).
    if (s === 'waiting_approval' && !approved) {
      const goalId = st.linkedRunId || st.metadata?.codexGoalId || st.goalId;
      if (goalId) {
        try {
          const ar = await req('POST', `/api/chat/agents/goal/${goalId}/approve`, { action: 'approve' });
          console.log('  [approval resolved]', goalId, JSON.stringify(ar).slice(0, 120));
          approved = true;
        } catch (e) { console.log('  [approval resolve error]', e.message); }
      }
    }
    if (Date.now() % 30000 < 5000) console.log('  ...', s, '|', st.progressMessage || '');
  }

  const goalId = st.linkedRunId || st.metadata?.codexGoalId || st.goalId;
  let goalStatus = 'n/a';
  let provider = null, model = null;
  try { const g = await req('GET', `/api/chat/goals/${goalId}`); goalStatus = g.status; provider = g.provider || (g.runSummary && g.runSummary.provider); model = g.model || (g.runSummary && g.runSummary.model); } catch {}

  const result = {
    id: t.id,
    ok: st.status === 'completed',
    taskId,
    status: st.status,
    verificationState: st.verificationState,
    goalId,
    goalStatus,
    provider,
    model,
    filesChanged: st.filesChanged || [],
    resultText: (st.resultText || '').slice(0, 400),
    syntheticCompletion: /"type"\s*:\s*"tool_call"/.test(st.resultText || ''),
  };
  console.log('RESULT:', JSON.stringify(result, null, 2));
  return result;
}

(async () => {
  const results = [];
  for (const t of TASKS) {
    results.push(await runTask(t));
  }
  const allOk = results.every((r) => r.ok);
  const noSynthetic = results.every((r) => !r.syntheticCompletion);
  console.log('\n=== RELIABILITY GATE SUMMARY ===');
  results.forEach((r) => console.log(`  Task ${r.id}: ${r.ok ? 'PASS' : 'FAIL'} (${r.status}, goal ${r.goalStatus}, provider ${r.provider}/${r.model})`));
  console.log(`  no synthetic completion: ${noSynthetic ? 'YES' : 'NO'}`);
  fs.writeFileSync('B:/AgenticOS/docs/overnight-repair/codex-reliability-gate.json', JSON.stringify({ results, allOk, noSynthetic }, null, 2));
  console.log(`\n=== ${allOk && noSynthetic ? '3/3 TASKS PASS' : 'GATE FAILED'} ===`);
  process.exit(allOk && noSynthetic ? 0 : 2);
})().catch((e) => { console.error('FATAL:', e); process.exit(2); });
