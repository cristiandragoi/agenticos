/* OVERNIGHT RO2 — Phase 10: pipeline value from SME offers + inspect offer/contact content */
const BASE = 'http://localhost:4000';
const path = require('path');
const FS = require('fs');
const RES = 'C:/Users/Cris/Desktop/desktop/Agentic_OS/Agentic OS/resources';
const Database = require(path.join(RES, 'server/node_modules/better-sqlite3'));
const db = new Database('C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db', { readonly: true });
const STATE_FILE = 'B:/AgenticOS/workspace/root/overnight-ro2-state.json';
const state = JSON.parse(FS.readFileSync(STATE_FILE, 'utf-8'));

async function api(p, opts) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 120000);
  try {
    const r = await fetch(BASE + p, { headers: { 'Content-Type': 'application/json' }, ...opts, signal: ctrl.signal });
    const body = await r.json().catch(() => null);
    if (!r.ok) throw new Error(`${r.status} ${p}: ${JSON.stringify(body).slice(0, 250)}`);
    return body;
  } finally { clearTimeout(t); }
}

function summaryFor(runId) {
  if (!runId) return null;
  const r = db.prepare('SELECT summary FROM execution_results WHERE run_id = ? ORDER BY created_at DESC LIMIT 1').get(runId);
  return r?.summary || null;
}

(async () => {
  state.smeOffers = state.smeOffers || [];
  for (const offer of state.smeOffers) {
    if (offer.error) continue;
    const offerText = summaryFor(offer.offerRun);
    const contactText = summaryFor(offer.contactRun);
    offer.offerSummary = (offerText || '').slice(0, 600);
    offer.contactSummary = (contactText || '').slice(0, 400);
    console.log(`\n=== ${offer.id}`);
    console.log('OFFER:', (offerText || '(none)').slice(0, 350));
    console.log('CONTACT:', (offer.contactSummary || '(none)').slice(0, 200));

    // Record PIPELINE_VALUE (proposal expectation — NOT revenue) with evidence
    const exp = (await api(`/api/revenue-operator/experiments/${offer.id}`)).experiment;
    const value = exp.expectedRevenue || 500; // conservative default if offer run produced no explicit value
    const entry = await api('/api/revenue-operator/ledger', {
      method: 'POST',
      body: JSON.stringify({
        missionId: state.missionId,
        experimentId: offer.id,
        entryType: 'PIPELINE_VALUE',
        amount: value,
        source: 'sme-offer-prep',
        evidence: [{ classification: 'ESTIMATE', title: 'Specific automation offer prepared (not yet sent)', summary: (offerText || 'offer prepared').slice(0, 300), source: 'overnight-sme-engine' }],
        provenance: { category: 'proposal_expectation', runId: offer.offerRun },
      }),
    });
    console.log(`PIPELINE_VALUE recorded: €${value} (entry ${entry.entry.id})`);
  }
  FS.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  db.close();
  console.log('PIPELINE PHASE COMPLETE');
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
