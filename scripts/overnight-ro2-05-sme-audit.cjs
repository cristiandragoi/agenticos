/* OVERNIGHT RO2 — SME evidence-quality audit: kill entries without verifiable public footprint */
const BASE = 'http://localhost:4000';
const FS = require('fs');
const STATE_FILE = 'B:/AgenticOS/workspace/root/overnight-ro2-state.json';
const state = JSON.parse(FS.readFileSync(STATE_FILE, 'utf-8'));

async function api(path, opts) {
  const r = await fetch(BASE + path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${r.status} ${path}: ${JSON.stringify(body).slice(0, 250)}`);
  return body;
}

/** Heuristic: an SME entry is ONLY credible if its evidence contains a real URL
 * or a concrete sourced fact. Generic-name + city-in-parens entries with no URL
 * are treated as unverified placeholders and KILLED (no fabricated pipeline). */
function credibility(exp) {
  const text = [exp.hypothesis, exp.problem, exp.targetCustomer, ...(exp.evidence || []).map(e => (e.summary || '') + ' ' + (e.source || ''))].filter(Boolean).join(' ');
  const hasUrl = /https?:\/\/|www\.[a-z0-9-]+\.[a-z]{2,}/i.test(text);
  const genericCityParens = /\((Berlin|Munich|Hamburg|Cologne|Frankfurt|Düsseldorf|Stuttgart|München|Köln)\)/i.test(exp.targetCustomer || exp.hypothesis);
  const largeCorp = /tchibo|zalando|siemens|allianz|telekom|deutsche bahn|lufthansa/i.test(text);
  return { hasUrl, genericCityParens, largeCorp, credible: hasUrl && !genericCityParens && !largeCorp };
}

(async () => {
  const exps = (await api(`/api/revenue-operator/experiments?missionId=${state.missionId}`)).experiments;
  const sme = exps.filter(e => e.engine === 'german_sme' && e.status === 'DISCOVERED');
  console.log('SME candidates to audit:', sme.length);
  state.smeAudit = [];
  let killed = 0;
  for (const exp of sme) {
    const c = credibility(exp);
    state.smeAudit.push({ id: exp.id, name: (exp.targetCustomer || exp.hypothesis).slice(0, 90), ...c });
    if (!c.credible) {
      try {
        await api(`/api/revenue-operator/experiments/${exp.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'KILLED' }) });
        killed++;
        console.log(`KILL (unverified/no-URL${c.largeCorp ? '/large-corp' : ''}): ${(exp.targetCustomer || exp.hypothesis).slice(0, 70)}`);
      } catch (e) { console.log(`kill failed ${exp.id}: ${e.message}`); }
    }
  }
  FS.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  const credible = state.smeAudit.filter(a => a.credible);
  console.log(`\nSME AUDIT: total=${sme.length} credible(with real URL)=${credible.length} killed=${killed}`);
  console.log('CREDIBLE:', credible.map(a => a.name).join(' | '));
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
