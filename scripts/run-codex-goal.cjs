/* ARGUS build harness — run a bounded Codex goal through the canonical path.
 * Usage: node scripts/run-codex-goal.cjs "<prompt>" [<timeoutMs>]
 * Uses the deployed backend (CODEX_API_BASE, default 127.0.0.1:4000) and the
 * canonical goal API with workspace B:\AgenticOS, auto-approval, preferred
 * provider (prov-deepseek). Polls to terminal state and prints tool activity. */
const BASE = process.env.CODEX_API_BASE || 'http://127.0.0.1:4000';
let prompt = process.argv[2];
const TIMEOUT_MS = parseInt(process.argv[3] || '300000', 10);
// @file support: read the prompt from a file to avoid shell-quoting issues.
if (prompt && prompt.startsWith('@')) {
  const fs = require('fs');
  prompt = fs.readFileSync(prompt.slice(1), 'utf8');
}
if (!prompt) { console.error('usage: run-codex-goal.cjs "<prompt>|@file" [timeoutMs]'); process.exit(2); }

(async () => {
  const created = await fetch(`${BASE}/api/chat/agents/goal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      goal: prompt,
      workspacePath: 'B:\\AgenticOS',
      repositoryRoot: 'B:\\AgenticOS',
      approvalPolicy: 'auto',
      executionOptions: { executionProviderId: 'prov-deepseek', disableFallback: false }
    })
  });
  const createdBody = await created.json();
  if (!created.ok || !createdBody.goalId) {
    console.log('CREATE FAILED', created.status, JSON.stringify(createdBody).slice(0, 400));
    process.exit(1);
  }
  const goalId = createdBody.goalId;
  console.log(`GOAL ${goalId} submitted (${new Date().toISOString()})`);

  const start = Date.now();
  let state = null;
  let history = [];
  let runSummary = null;
  while (Date.now() - start < TIMEOUT_MS) {
    await new Promise(r => setTimeout(r, 4000));
    const res = await fetch(`${BASE}/api/chat/agents/goal/${goalId}`);
    if (!res.ok) continue;
    const g = await res.json();
    state = g.status;
    history = g.history || [];
    runSummary = g.runSummary || null;
    if (['completed', 'failed', 'stopped', 'cancelled', 'paused'].includes(state)) break;
  }

  console.log(`TERMINAL state=${state} durationMs=${Date.now() - start}`);
  const toolEvents = history.filter(e => ['tool_started', 'tool_completed', 'planning_started', 'agent_completed', 'step_failed', 'task_failed'].includes(e.eventType));
  toolEvents.forEach(e => {
    const m = (e.message || '').slice(0, 300);
    console.log(`  [${e.eventType}] ${m}`);
    if (e.payload && (e.payload.tool || e.payload.path)) {
      console.log(`    payload: ${JSON.stringify({ tool: e.payload.tool, path: e.payload.path, cmd: e.payload.command, args: e.payload.args }).slice(0, 300)}`);
    }
  });
  const last = history.slice(-2).map(e => `[${e.state}] ${(e.message || '').slice(0, 250)}`);
  last.forEach(l => console.log(`  TAIL ${l}`));
  if (runSummary) console.log(`  RUNSUMMARY ${JSON.stringify(runSummary).slice(0, 500)}`);

  const ok = state === 'completed';
  console.log(`RESULT ${ok ? 'PASS' : 'FAIL'}`);
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
