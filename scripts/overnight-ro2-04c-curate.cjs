/* OVERNIGHT RO2 — Phase 4c: final digital portfolio curation — kill meta/duplicate clusters, select GO builds */
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

(async () => {
  const exps = (await api(`/api/revenue-operator/experiments?missionId=${state.missionId}`)).experiments;
  const dp = exps.filter(e => e.engine === 'digital_products' && e.status !== 'KILLED');
  const spOf = (e) => { try { return (typeof e.scorePayload === 'string' ? JSON.parse(e.scorePayload) : (e.scorePayload || {})).overallScore || 0; } catch { return 0; } };

  const killed = [];
  const kill = async (id, reason) => {
    await api(`/api/revenue-operator/experiments/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'KILLED' }) });
    killed.push({ id, reason });
    console.log(`KILL ${id}: ${reason}`);
  };

  // 1. Meta-experiments (discovery summaries, not products)
  for (const e of dp) {
    if (/^Identified \d+ concrete/i.test(e.product || e.hypothesis)) await kill(e.id, 'meta-summary, not a product');
  }

  // 2. Semantic clusters (second-pass): GDPR packs, VAT toolkits, Notion finance systems
  const alive = dp.filter(e => !killed.some(k => k.id === e.id));
  const clusters = [
    { key: 'gdpr_pack', match: (t) => /gdpr|datenschutz|dsgvo/i.test(t) },
    { key: 'vat_toolkit', match: (t) => /vat|umsatzsteuer|e-commerce compliance/i.test(t) },
    { key: 'notion_finance', match: (t) => /notion.*(finance|finanz|launch os)/i.test(t) },
    { key: 'freelancer_tax', match: (t) => /freelancer tax|income tax calculator/i.test(t) },
  ];
  for (const c of clusters) {
    const members = alive.filter(e => !killed.some(k => k.id === e.id) && c.match(e.product || e.hypothesis));
    if (members.length < 2) continue;
    members.sort((a, b) => spOf(b) - spOf(a));
    const [keep, ...rest] = members;
    console.log(`CLUSTER ${c.key}: keep ${keep.id} (score ${spOf(keep)}), kill ${rest.length}`);
    for (const r of rest) await kill(r.id, `duplicate of ${keep.id} in cluster ${c.key}`);
  }

  FS.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

  // 3. Final ranked portfolio
  const final = (await api(`/api/revenue-operator/experiments?missionId=${state.missionId}`)).experiments
    .filter(e => e.engine === 'digital_products' && e.status !== 'KILLED')
    .sort((a, b) => spOf(b) - spOf(a));
  state.portfolio = final.map(e => ({ id: e.id, score: spOf(e), status: e.status, title: (e.product || e.hypothesis).slice(0, 110) }));
  FS.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  console.log(`\nFINAL PORTFOLIO (${final.length} candidates):`);
  for (const e of final) console.log(`  ${spOf(e).toFixed(1).padStart(6)} ${e.id} [${e.status}] ${(e.product || e.hypothesis).slice(0, 85)}`);
  state.goBuilds = final.slice(0, 3).map(e => e.id);
  FS.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  console.log('\nGO BUILDS:', state.goBuilds.join(', '));
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
