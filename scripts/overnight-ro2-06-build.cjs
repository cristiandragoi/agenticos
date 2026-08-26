/* OVERNIGHT RO2 — Phase 5: BUILD the 3 GO products via canonical Codex execution path */
const BASE = 'http://localhost:4000';
const FS = require('fs');
const STATE_FILE = 'B:/AgenticOS/workspace/root/overnight-ro2-state.json';
const state = JSON.parse(FS.readFileSync(STATE_FILE, 'utf-8'));
state.builds = state.builds || [];

async function build(id) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 900000); // 15 min ceiling per build
  try {
    const r = await fetch(`${BASE}/api/revenue-engine/experiments/${id}/build`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}), signal: ctrl.signal,
    });
    const body = await r.json().catch(() => null);
    if (!r.ok) throw new Error(`${r.status}: ${JSON.stringify(body).slice(0, 300)}`);
    return body;
  } finally { clearTimeout(t); }
}

(async () => {
  for (const id of (state.goBuilds || [])) {
    const started = Date.now();
    console.log(`BUILD START ${id}`);
    try {
      const res = await build(id);
      const out = {
        id, ms: Date.now() - started,
        status: res.experiment?.status,
        dispatchOk: res.dispatch?.ok,
        runId: res.dispatch?.runId,
        goalId: res.dispatch?.goalId,
        verdict: res.dispatch?.verdict,
        error: res.dispatch?.error || null,
      };
      state.builds.push(out);
      console.log(`BUILD DONE ${id}: status=${out.status} ok=${out.dispatchOk} verdict=${out.verdict} run=${out.runId} (${Math.round(out.ms / 1000)}s)${out.error ? ' ERR: ' + out.error : ''}`);
    } catch (e) {
      state.builds.push({ id, ms: Date.now() - started, error: e.message });
      console.log(`BUILD FAILED ${id}: ${e.message}`);
    }
    FS.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  }
  console.log('BUILD PHASE COMPLETE');
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
