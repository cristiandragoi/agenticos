/* OVERNIGHT RO2 — Phase 3: German SME discovery batches (canonical Hermes pipeline) */
const BASE = 'http://localhost:4000';
const FS = require('fs');
const STATE_FILE = 'B:/AgenticOS/workspace/root/overnight-ro2-state.json';
const state = JSON.parse(FS.readFileSync(STATE_FILE, 'utf-8'));
state.smeDiscovery = state.smeDiscovery || [];

const SECTORS = [
  { sector: 'Handwerk / trades businesses (electricians, plumbers, carpenters)', count: 8 },
  { sector: 'small retail and e-commerce businesses', count: 7 },
  { sector: 'professional services (accountants, lawyers, insurance brokers, consultancies)', count: 8 },
  { sector: 'medical and healthcare practices (dentists, physiotherapists, small clinics)', count: 7 },
];

async function discover(sector, count) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 570000);
  try {
    const r = await fetch(`${BASE}/api/revenue-engine/german-sme/discover`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ missionId: state.missionId, count, sector, market: 'Germany' }),
      signal: ctrl.signal,
    });
    const body = await r.json();
    if (!r.ok) throw new Error(`${r.status}: ${JSON.stringify(body).slice(0, 300)}`);
    return body;
  } finally { clearTimeout(t); }
}

(async () => {
  for (const s of SECTORS) {
    const started = Date.now();
    try {
      const res = await discover(s.sector, s.count);
      const created = (res.experiments || []).map(e => ({ id: e.id, title: (e.targetCustomer || e.hypothesis || '').slice(0, 90), status: e.status }));
      state.smeDiscovery.push({ sector: s.sector, count: s.count, created, run: res.dispatch?.runId, verdict: res.dispatch?.verdict, ms: Date.now() - started });
      console.log(`SME BATCH [${s.sector.slice(0, 40)}]: +${created.length} (${Math.round((Date.now() - started) / 1000)}s)`);
      for (const c of created) console.log('   -', c.id, c.title);
    } catch (e) {
      state.smeDiscovery.push({ sector: s.sector, error: e.message, ms: Date.now() - started });
      console.log(`SME BATCH [${s.sector.slice(0, 40)}] FAILED: ${e.message}`);
    }
    FS.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  }
  const total = state.smeDiscovery.reduce((s, b) => s + (b.created?.length || 0), 0);
  console.log('SME DISCOVERY TOTAL new companies:', total);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
