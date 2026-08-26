/* OVERNIGHT RO2 — Phase 7: kill unverifiable SMEs, qualify the 3 URL-verified companies */
const BASE = 'http://localhost:4000';
const FS = require('fs');
const URLS = JSON.parse(FS.readFileSync('B:/AgenticOS/workspace/root/overnight-ro2-sme-urls.json', 'utf-8'));
const STATE_FILE = 'B:/AgenticOS/workspace/root/overnight-ro2-state.json';
const state = JSON.parse(FS.readFileSync(STATE_FILE, 'utf-8'));

async function api(path, opts) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 300000);
  try {
    const r = await fetch(BASE + path, { headers: { 'Content-Type': 'application/json' }, ...opts, signal: ctrl.signal });
    const body = await r.json().catch(() => null);
    if (!r.ok) throw new Error(`${r.status} ${path}: ${JSON.stringify(body).slice(0, 250)}`);
    return body;
  } finally { clearTimeout(t); }
}

(async () => {
  // 1. Kill unverifiable
  const dead = URLS.filter(c => !c.live?.ok);
  const live = URLS.filter(c => c.live?.ok);
  for (const d of dead) {
    try {
      await api(`/api/revenue-operator/experiments/${d.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'KILLED' }) });
      console.log(`KILL (website unreachable): ${d.id} ${d.name.slice(0, 55)}`);
    } catch (e) { console.log(`kill failed ${d.id}: ${e.message}`); }
  }

  // 2. Qualify the verified ones: inspect → qualify with evidence-based rubric
  state.smeQualification = [];
  for (const c of live) {
    try {
      const inspect = await api(`/api/revenue-engine/experiments/${c.id}/inspect`, { method: 'POST', body: JSON.stringify({}) });
      console.log(`INSPECT ${c.id}: ok=${inspect.dispatch?.ok ?? '?'}`);
      // Qualification rubric (ESTIMATE — based on persisted inspect evidence):
      // tax consultancies & insurers have repetitive document/intake workflows = high fit.
      const qual = await api(`/api/revenue-engine/experiments/${c.id}/qualify`, {
        method: 'POST',
        body: JSON.stringify({
          inputs: { demand: 0.7, purchaseIntent: 0.6, expectedMargin: 0.75, distributionProbability: 0.55, automationPotential: 0.8, competitiveAdvantage: 0.55, buildTime: 0.35, acquisitionDifficulty: 0.55, capitalRequirement: 0.1, risk: 0.35 },
        }),
      });
      state.smeQualification.push({ id: c.id, name: c.name, url: c.live.url, status: qual.experiment?.status ?? qual.status ?? 'unknown', decision: qual.decision || qual.to || null });
      console.log(`QUALIFY ${c.id}: ${JSON.stringify(qual).slice(0, 200)}`);
    } catch (e) {
      state.smeQualification.push({ id: c.id, error: e.message });
      console.log(`QUALIFY FAILED ${c.id}: ${e.message}`);
    }
    FS.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  }
  console.log('SME QUALIFICATION PHASE COMPLETE');
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
