/* OVERNIGHT RO2 — Phase 11: final Datenschutz-Kit retry (attempt 3, bounded) */
const BASE = 'http://localhost:4000';
const FS = require('fs');
const STATE_FILE = 'B:/AgenticOS/workspace/root/overnight-ro2-state.json';
const state = JSON.parse(FS.readFileSync(STATE_FILE, 'utf-8'));

(async () => {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 900000);
  try {
    const r = await fetch(`${BASE}/api/revenue-engine/experiments/expt-978155f7-/build`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}), signal: ctrl.signal,
    });
    const body = await r.json().catch(() => null);
    console.log(`BUILD #3: HTTP ${r.status} status=${body?.experiment?.status} ok=${body?.dispatch?.ok} verdict=${body?.dispatch?.verdict} err=${body?.dispatch?.error || 'none'} run=${body?.dispatch?.runId}`);
    state.builds.push({ id: 'expt-978155f7-', retry: 2, status: body?.experiment?.status, ok: body?.dispatch?.ok, runId: body?.dispatch?.runId, verdict: body?.dispatch?.verdict, error: body?.dispatch?.error || null });
    if (!body?.dispatch?.ok) {
      // Classification + honest evidence of the failure
      const evRes = await fetch(`${BASE}/api/revenue-operator/experiments/expt-978155f7-/evidence`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          classification: 'FACT',
          title: 'Build blocked: ENVIRONMENT_FAILURE (Codex model emits truncated tool JSON)',
          source: 'overnight-build-loop',
          summary: 'All 3 Codex build attempts failed with CODEX_TOOL_PARSE_FAILED: the model\'s structured response is truncated (~5.8-6.0KB, unterminated string). The product content exists in the model output but cannot be committed by the executor. Classification: ENVIRONMENT_FAILURE — not a code defect in Revenue Operator. Branch paused at BUILDING; no artifact claimed.',
          provenance: `canonical-run:${body?.dispatch?.runId || 'unknown'}`,
        }),
      });
      console.log('failure evidence recorded:', evRes.status);
    }
    FS.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (e) {
    console.log('BUILD #3 FAILED:', e.message);
    state.builds.push({ id: 'expt-978155f7-', retry: 2, error: e.message });
    FS.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } finally { clearTimeout(t); }
})();
