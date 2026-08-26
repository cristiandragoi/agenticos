/* OVERNIGHT RO2 — Phase 1: create tonight's mission, seed channels, baseline snapshot */
const BASE = 'http://localhost:4000';
const state = { startedAt: new Date().toISOString(), missionId: null, phases: [] };
const FS = require('fs');
const STATE_FILE = 'B:/AgenticOS/workspace/root/overnight-ro2-state.json';
const save = () => FS.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

async function api(path, opts) {
  const r = await fetch(BASE + path, opts);
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${r.status} ${path}: ${JSON.stringify(body).slice(0, 300)}`);
  return body;
}

(async () => {
  // 1. Tonight's primary mission
  const m = await api('/api/revenue-operator/missions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Overnight Revenue Mission — €300 Verified in 30 Days',
      description: 'PRIMARY MISSION: €300 verified revenue, €0 ad budget, Germany/EU. Engines: Digital Products + German SME AI Automation. Channel: Shopify (auth gate pending). Tonight: discover → research → validate → score → build → QA → prepare. No fake revenue, no unauthorized outbound.',
      targetAmount: 300, currency: 'EUR',
      startDate: new Date().toISOString().split('T')[0],
      deadline: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
      advertisingBudget: 0,
      enabledEngines: ['digital_products', 'german_sme'],
      availableChannels: ['SHOPIFY', 'DIRECT_OUTREACH'],
      primaryMarket: 'DE/EU',
    }),
  });
  state.missionId = m.mission.id;
  console.log('MISSION:', m.mission.id, m.mission.deadline);

  // 2. Seed distribution channels
  const ch = await api('/api/revenue-operator/channels/seed', { method: 'POST' });
  console.log('CHANNELS seeded:', ch.channels.length, ch.channels.map(c => `${c.channel}=${c.status}`).join(', '));

  // 3. Baseline snapshot
  const exps = await api('/api/revenue-operator/experiments');
  const gates = await api('/api/revenue-operator/gates');
  const ledger = await api('/api/revenue-operator/ledger');
  console.log('BASELINE: experiments=', exps.experiments.length, 'gates=', gates.gates.length, 'ledger=', ledger.entries.length);
  state.baseline = { experiments: exps.experiments.length, gates: gates.gates.length, ledger: ledger.entries.length };
  save();
  console.log('STATE saved to', STATE_FILE);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
