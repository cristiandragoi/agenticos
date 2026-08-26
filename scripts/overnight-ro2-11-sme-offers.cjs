/* OVERNIGHT RO2 — Phase 9: SME offer prep + OUTBOUND_APPROVAL gates (no outbound sent!) */
const BASE = 'http://localhost:4000';
const FS = require('fs');
const STATE_FILE = 'B:/AgenticOS/workspace/root/overnight-ro2-state.json';
const state = JSON.parse(FS.readFileSync(STATE_FILE, 'utf-8'));

const SME_IDS = ['expt-fe395ce1-', 'expt-15990784-', 'expt-196b4b22-'];

async function api(path, opts) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 600000);
  try {
    const r = await fetch(BASE + path, { headers: { 'Content-Type': 'application/json' }, ...opts, signal: ctrl.signal });
    const body = await r.json().catch(() => null);
    if (!r.ok) throw new Error(`${r.status} ${path}: ${JSON.stringify(body).slice(0, 250)}`);
    return body;
  } finally { clearTimeout(t); }
}

(async () => {
  state.smeOffers = [];
  for (const id of SME_IDS) {
    const entry = { id };
    try {
      // CONTACT_READY path: find contact route (research only — no sending)
      const contact = await api(`/api/revenue-engine/experiments/${id}/find-contact`, { method: 'POST', body: JSON.stringify({}) });
      entry.contactRun = contact.dispatch?.runId || null;
      entry.contactOk = contact.dispatch?.ok ?? null;

      // Specific offer (build a concrete automation hypothesis, not generic AI pitch)
      const offer = await api(`/api/revenue-engine/experiments/${id}/create-offer`, { method: 'POST', body: JSON.stringify({}) });
      entry.offerRun = offer.dispatch?.runId || null;
      entry.offerOk = offer.dispatch?.ok ?? null;

      // Gate the outreach — creates OUTBOUND_APPROVAL, pauses branch. NO outreach sent.
      const gate = await api(`/api/revenue-engine/experiments/${id}/gate-outreach`, {
        method: 'POST',
        body: JSON.stringify({ description: 'Outbound contact prepared but NOT sent — awaiting human approval of recipient, channel and message content.' }),
      });
      entry.gateId = gate.gate?.id || null;
      state.smeOffers.push(entry);
      console.log(`SME ${id}: contact-ok=${entry.contactOk} offer-ok=${entry.offerOk} gate=${entry.gateId}`);
    } catch (e) {
      entry.error = e.message;
      state.smeOffers.push(entry);
      console.log(`SME ${id} FAILED: ${e.message}`);
    }
    FS.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  }
  console.log('PHASE 9 COMPLETE — no outbound communication was sent');
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
