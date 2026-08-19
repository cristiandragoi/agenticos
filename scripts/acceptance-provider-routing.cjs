/* CODEX PROVIDER ROUTING RECOVERY — bounded acceptance harness.
 * Runs the exact mission prompt "Return exactly: CODEX_PROVIDER_OK" through the
 * real goal path (POST /api/chat/agents/goal -> codexLoop -> gateway router ->
 * provider -> executor), N consecutive times. Uses the explicit run-setting
 * provider (executionOptions.executionProviderId) — the path that previously
 * collapsed to a single provider (forced) and hard-failed on any transport
 * blip. Prints routing evidence from goal events. */
const BASE = process.env.CODEX_API_BASE || 'http://127.0.0.1:4001';
const RUNS = parseInt(process.env.CODEX_RUNS || '1', 10);
const TIMEOUT_MS = parseInt(process.env.CODEX_RUN_TIMEOUT_MS || '150000', 10);

async function runGoal(runIndex) {
  const prompt = 'Return exactly: CODEX_PROVIDER_OK';
  const created = await fetch(`${BASE}/api/chat/agents/goal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      goal: prompt,
      approvalPolicy: 'auto',
      executionOptions: { executionProviderId: 'prov-deepseek', disableFallback: false }
    })
  });
  const createdBody = await created.json();
  if (!created.ok || !createdBody.goalId) {
    console.log(`RUN ${runIndex} CREATE FAILED status=${created.status}`, JSON.stringify(createdBody).slice(0, 300));
    return { ok: false, reason: 'create-failed' };
  }
  const goalId = createdBody.goalId;
  console.log(`RUN ${runIndex} goalId=${goalId} (${new Date().toISOString()})`);

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

  const terminal = ['completed', 'failed', 'stopped', 'cancelled', 'paused'].includes(state);
  const events = history.slice(-8).map(e => `[${e.state}] ${(e.message || '').slice(0, 240)}`);
  console.log(`RUN ${runIndex} terminal=${state} durationMs=${Date.now() - start}`);
  events.forEach(ev => console.log(`  ${ev}`));
  const providerEvents = history.filter(e => e.provider || e.model).slice(-4);
  providerEvents.forEach(e => console.log(`  PROVIDER-TRACE [${e.state}] provider=${e.provider || '?'} model=${e.model || '?'}`));
  if (runSummary) console.log(`  RUNSUMMARY ${JSON.stringify(runSummary).slice(0, 400)}`);

  const finalMsgs = history.filter(e => e.eventType === 'agent_completed' || e.eventType === 'task_failed').slice(-2);
  finalMsgs.forEach(e => console.log(`  FINAL [${e.eventType}] ${(e.message || '').slice(0, 300)}`));

  const ok = state === 'completed';
  const text = history.map(e => e.message || '').join('\n');
  const gotExact = /CODEX_PROVIDER_OK/.test(text);
  console.log(`RUN ${runIndex} RESULT=${ok ? 'PASS' : 'FAIL'} exactToken=${gotExact}`);
  return { ok, goalId, state, gotExact };
}

(async () => {
  const results = [];
  for (let i = 1; i <= RUNS; i++) {
    const r = await runGoal(i);
    results.push(r);
    if (!r.ok) {
      console.log(`ABORT: run ${i} failed — stopping further runs`);
      break;
    }
  }
  const passed = results.filter(r => r.ok).length;
  console.log(`SUMMARY runs=${results.length} passed=${passed}`);
  process.exit(passed === results.length && results.length > 0 ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
