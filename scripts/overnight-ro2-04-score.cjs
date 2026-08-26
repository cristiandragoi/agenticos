/* OVERNIGHT RO2 — Phase 4: score digital product candidates via canonical scoring architecture.
 * Rubric-based ESTIMATE scoring over each experiment's PERSISTED evidence (no invented market data).
 * Then canonical GO/NO-GO decision; dedupe near-duplicate clusters (keep best, KILL the rest).
 */
const BASE = 'http://localhost:4000';
const FS = require('fs');
const STATE_FILE = 'B:/AgenticOS/workspace/root/overnight-ro2-state.json';
const state = JSON.parse(FS.readFileSync(STATE_FILE, 'utf-8'));

async function api(path, opts) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 120000);
  try {
    const r = await fetch(BASE + path, { headers: { 'Content-Type': 'application/json' }, ...opts, signal: ctrl.signal });
    const body = await r.json().catch(() => null);
    if (!r.ok) throw new Error(`${r.status} ${path}: ${JSON.stringify(body).slice(0, 250)}`);
    return body;
  } finally { clearTimeout(t); }
}

/** Transparent rubric: derive score inputs from persisted evidence text. */
function rubric(exp) {
  const text = [exp.hypothesis, exp.problem, exp.product, exp.offer, ...(exp.evidence || []).map(e => e.summary || e.title || '')].filter(Boolean).join(' ').toLowerCase();
  const has = (...words) => words.some(w => text.includes(w));
  const clamp = (v) => Math.max(0.05, Math.min(0.95, v));

  // demand: concrete pain + market signals
  let demand = 0.5;
  if (has('pain', 'complex', 'costly', 'time-consuming', 'mandatory', 'required', 'pflicht', 'gesetzlich', 'problem')) demand += 0.15;
  if (has('many', 'market', 'demand', 'growing', 'thousands', 'zahlreiche', 'viele')) demand += 0.1;
  // purchase intent: compliance/legal/money matters = high; nice-to-have = lower
  let purchaseIntent = 0.5;
  if (has('vat', 'tax', 'gdpr', 'dsgvo', 'compliance', 'steuer', 'legal', 'finanzamt', 'invoice', 'rechnung', 'payroll', 'lohnbuchhaltung')) purchaseIntent = 0.75;
  if (has('nice-to-have', 'entertainment', 'fun')) purchaseIntent = 0.35;
  // margin: digital delivery, zero inventory
  let expectedMargin = 0.8;
  if (has('support-heavy', 'consulting required')) expectedMargin = 0.6;
  // distribution: known channel present
  let distributionProbability = 0.45;
  if (has('shopify', 'seo', 'email', 'etsy', 'gumroad', 'marketplace')) distributionProbability = 0.65;
  if (has('direct outreach', 'outreach')) distributionProbability = 0.6;
  // automation potential: template/spreadsheet/checklist = very high
  let automationPotential = 0.7;
  if (has('spreadsheet', 'template', 'checklist', 'calculator', 'sop', 'notion', 'vorlage')) automationPotential = 0.88;
  // competitive advantage: german-language niche / compliance specificity
  let competitiveAdvantage = 0.4;
  if (has('german', 'deutsch', 'german-language', 'eur', 'oss', 'eür', 'mini-job')) competitiveAdvantage = 0.6;
  if (has('saturated', 'many competitors', 'crowded')) competitiveAdvantage = 0.3;
  // lower-is-better components
  let buildTime = 0.35; // spreadsheet/template ~ fast
  if (has('complex integration', 'api integration', 'custom software')) buildTime = 0.65;
  if (has('simple spreadsheet', 'checklist', 'one-day', 'quick')) buildTime = 0.2;
  let acquisitionDifficulty = 0.5;
  if (has('paid ads required', 'advertising needed')) acquisitionDifficulty = 0.85;
  if (has('seo', 'organic', 'community')) acquisitionDifficulty = 0.4;
  const capitalRequirement = 0.1; // €0 inventory by mission constraint
  let risk = 0.3;
  if (has('legal advice', 'tax advice', 'regulated')) risk = 0.6; // advisory-adjacent caution
  if (has('copyright', 'ip risk')) risk = 0.7;

  return {
    demand: clamp(demand), purchaseIntent: clamp(purchaseIntent), expectedMargin: clamp(expectedMargin),
    distributionProbability: clamp(distributionProbability), automationPotential: clamp(automationPotential),
    competitiveAdvantage: clamp(competitiveAdvantage), buildTime, acquisitionDifficulty, capitalRequirement, risk,
  };
}

(async () => {
  const exps = (await api(`/api/revenue-operator/experiments?missionId=${state.missionId}`)).experiments;
  const dp = exps.filter(e => e.engine === 'digital_products' && e.status === 'DISCOVERED');
  console.log('digital experiments to score:', dp.length);
  state.scoring = state.scoring || [];

  for (const exp of dp) {
    try {
      const inputs = rubric(exp);
      const scoreRes = await api(`/api/revenue-engine/experiments/${exp.id}/score`, { method: 'POST', body: JSON.stringify(inputs) });
      const decide = await api(`/api/revenue-engine/experiments/${exp.id}/decide`, { method: 'POST', body: JSON.stringify({}) });
      state.scoring.push({ id: exp.id, title: (exp.product || exp.hypothesis).slice(0, 100), overall: scoreRes.score?.overall, go: decide.go, reason: decide.reason });
      console.log(`SCORE ${exp.id}: overall=${scoreRes.score?.overall?.toFixed?.(3)} -> ${decide.go ? 'GO' : 'NO-GO'} (${decide.reason?.slice(0, 60)})`);
    } catch (e) {
      state.scoring.push({ id: exp.id, error: e.message });
      console.log(`SCORE ${exp.id} FAILED: ${e.message}`);
    }
    FS.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  }

  // Dedupe: cluster by normalized first 6 significant words; keep highest overall, KILL the rest.
  const scored = state.scoring.filter(s => typeof s.overall === 'number');
  const clusters = new Map();
  const norm = (t) => t.toLowerCase().replace(/[^a-zäöüß ]/g, ' ').split(/\s+/).filter(w => w.length > 3).slice(0, 6).join(' ');
  for (const s of scored) {
    const key = norm(s.title);
    if (!clusters.has(key)) clusters.set(key, []);
    clusters.get(key).push(s);
  }
  state.killedDuplicates = [];
  for (const [key, members] of clusters) {
    if (members.length < 2) continue;
    members.sort((a, b) => b.overall - a.overall);
    const [keep, ...rest] = members;
    for (const dup of rest) {
      try {
        await api(`/api/revenue-operator/experiments/${dup.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'KILLED' }) });
        state.killedDuplicates.push({ id: dup.id, title: dup.title, clusterKey: key, keptInstead: keep.id });
        console.log(`DEDUPE KILL ${dup.id} (cluster "${key.slice(0, 40)}", kept ${keep.id})`);
      } catch (e) { console.log(`DEDUPE KILL ${dup.id} failed: ${e.message}`); }
    }
  }
  FS.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

  const go = state.scoring.filter(s => s.go === true);
  const noGo = state.scoring.filter(s => s.go === false);
  console.log(`\nSCORING SUMMARY: scored=${state.scoring.length} GO=${go.length} NO-GO=${noGo.length} duplicatesKilled=${state.killedDuplicates.length}`);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
