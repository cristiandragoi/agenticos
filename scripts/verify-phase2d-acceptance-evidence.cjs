// verify-phase2d-acceptance-evidence.cjs — deterministic evidence check (no LLM).
// Reads docs/phase2d-acceptance-trace.json (produced by the isolated acceptance
// run) and asserts the real-execution evidence is present and truthful.
const fs = require('fs');
const path = require('path');

const TRACE = 'B:/AgenticOS/docs/phase2d-acceptance-trace.json';
let failures = 0;
function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
  if (!ok) failures++;
}

if (!fs.existsSync(TRACE)) {
  console.log(`FAIL  acceptance trace missing: ${TRACE}`);
  process.exit(1);
}
const t = JSON.parse(fs.readFileSync(TRACE, 'utf8'));

// Hermes real execution.
check('Hermes real worker executed (agent instance + provider)',
  !!t.hermes && !!t.hermes.run && !!t.hermes.run.agentInstanceId && !!t.hermes.provider,
  `hermes ${t.hermes?.provider}/${t.hermes?.model} agent=${t.hermes?.run?.agentInstanceId} run=${t.hermes?.run?.runId} dur=${t.hermes?.run?.durationMs}ms`);
check('Hermes run completed with a real result',
  t.hermes?.run?.status === 'completed' && !!t.hermes?.run?.resultSummary,
  `result ${t.hermes?.run?.resultId}`);

// CodeX real execution.
check('CodeX real worker executed (agent instance + provider)',
  !!t.codex && !!t.codex.run && !!t.codex.run.agentInstanceId && !!t.codex.provider,
  `codex ${t.codex?.provider}/${t.codex?.model} agent=${t.codex?.run?.agentInstanceId} run=${t.codex?.run?.runId} dur=${t.codex?.run?.durationMs}ms`);
check('CodeX run completed with a real artifact result',
  t.codex?.run?.status === 'completed' && !!t.codex?.run?.resultSummary,
  `result ${t.codex?.run?.resultId}: ${(t.codex?.run?.resultSummary || '').slice(0, 120)}`);

// Negative: resolved gate → BLOCKED_INTEGRATION_REQUIRED, no publish.
check('missing-integration publish blocks truthfully (no fake execution)',
  t.negative?.status === 'blocked' && t.negative?.publishedCount === 0,
  `blockedReason=${t.negative?.blockedReason} published=${t.negative?.publishedCount}`);

// No orphaned running runs.
check('no orphaned running runs', Array.isArray(t.orphanCheck?.runningRuns) && t.orphanCheck.runningRuns.length === 0,
  `running=${t.orphanCheck?.runningRuns?.length ?? 'n/a'}`);

// Digital branch held by an open Shopify gate.
check('Digital branch stops at Shopify Human Gate',
  t.gateCheck?.digital?.status === 'open' && t.gateCheck?.digital?.gate_type === 'SHOPIFY_AUTH_REQUIRED',
  `gate=${t.gateCheck?.digital?.status}`);

console.log(`\nPHASE 2D ACCEPTANCE EVIDENCE: ${failures === 0 ? 'PASS' : 'FAIL'} (${failures} failure(s))`);
process.exit(failures === 0 ? 0 : 1);
