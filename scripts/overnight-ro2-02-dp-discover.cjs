/* OVERNIGHT RO2 — Phase 2: Digital Product discovery batches (canonical Hermes pipeline) */
const BASE = 'http://localhost:4000';
const FS = require('fs');
const STATE_FILE = 'B:/AgenticOS/workspace/root/overnight-ro2-state.json';
const state = JSON.parse(FS.readFileSync(STATE_FILE, 'utf-8'));
state.digitalDiscovery = state.digitalDiscovery || [];

async function discover(count) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 570000);
  try {
    const r = await fetch(`${BASE}/api/revenue-engine/digital-products/discover`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ missionId: state.missionId, count }),
      signal: ctrl.signal,
    });
    const body = await r.json();
    if (!r.ok) throw new Error(`${r.status}: ${JSON.stringify(body).slice(0, 300)}`);
    return body;
  } finally { clearTimeout(t); }
}

(async () => {
  for (const count of [6, 5, 5, 4]) {
    const started = Date.now();
    try {
      const res = await discover(count);
      const created = (res.experiments || []).map(e => ({ id: e.id, title: (e.product || e.hypothesis || '').slice(0, 90), status: e.status }));
      state.digitalDiscovery.push({ count, created, dispatchRun: res.dispatch?.runId, verdict: res.dispatch?.verdict, ok: res.dispatch?.ok, ms: Date.now() - started });
      console.log(`BATCH count=${count}: +${created.length} experiments (${Math.round((Date.now() - started) / 1000)}s, run=${res.dispatch?.runId}, verdict=${res.dispatch?.verdict})`);
      for (const c of created) console.log('   -', c.id, c.title);
    } catch (e) {
      state.digitalDiscovery.push({ count, error: e.message, ms: Date.now() - started });
      console.log(`BATCH count=${count} FAILED: ${e.message}`);
    }
    FS.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  }
  const total = state.digitalDiscovery.reduce((s, b) => s + (b.created?.length || 0), 0);
  console.log('DIGITAL DISCOVERY TOTAL new experiments:', total);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
