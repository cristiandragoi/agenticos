// test-m5-runtime.cjs — M5 Digital Product Engine runtime verification against :4001.
const BASE = 'http://127.0.0.1:4001';
const results = [];
function check(name, ok, evidence) {
  results.push({ name, ok });
  console.log(`${ok ? '[PASS]' : '[FAIL]'} ${name} — ${evidence}`);
}

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

async function main() {
  const stamp = Date.now().toString(36);

  // 1. Create a mission
  const m = await api('POST', '/api/revenue-operator/missions', {
    title: `M5 runtime verify ${stamp}`,
    targetAmount: 300, currency: 'EUR',
    startDate: '2026-08-19', deadline: '2026-09-18',
    advertisingBudget: 0, enabledEngines: ['digital_products'],
  });
  check('create mission', m.status === 201 && m.json?.mission?.id, `status=${m.status} id=${m.json?.mission?.id}`);
  const missionId = m.json?.mission?.id;

  // 2. Create a digital_products experiment
  const e = await api('POST', '/api/revenue-operator/experiments', {
    missionId, engine: 'digital_products', hypothesis: 'Spreadsheet template pack for DE SMEs',
    product: 'SME cashflow spreadsheet pack', price: 49, targetCustomer: 'German SME',
  });
  check('create experiment', e.status === 201 && e.json?.experiment?.id, `status=${e.status} status0=${e.json?.experiment?.status}`);
  const expId = e.json?.experiment?.id;

  // 3. next-action (pure lifecycle map)
  const na = await api('GET', `/api/revenue-engine/experiments/${expId}/next-action`);
  check('next-action DISCOVERED→validate', na.status === 200 && na.json?.nextAction === 'validate', `nextAction=${na.json?.nextAction}`);

  // 4. score (validate + score, no worker)
  const sc = await api('POST', `/api/revenue-engine/experiments/${expId}/score`, {
    demand: 0.8, purchaseIntent: 0.7, expectedMargin: 0.8, distributionProbability: 0.6,
    automationPotential: 0.9, competitiveAdvantage: 0.5, buildTime: 0.3, acquisitionDifficulty: 0.4,
    capitalRequirement: 0.2, risk: 0.3,
  });
  check('score returns payload', sc.status === 200 && typeof sc.json?.score?.overallScore === 'number', `overallScore=${sc.json?.score?.overallScore}`);

  // 5. decide (GO/NO-GO from score)
  const d = await api('POST', `/api/revenue-engine/experiments/${expId}/decide`, {});
  check('decide → GO (APPROVED)', d.status === 200 && d.json?.go === true && d.json?.to === 'APPROVED', `go=${d.json?.go} to=${d.json?.to} reason=${d.json?.reason}`);

  // 6. measure (ledger + aggregates)
  const meas = await api('POST', `/api/revenue-engine/experiments/${expId}/measure`, { revenue: 100, cost: 20, clicks: 50, conversions: 3 });
  check('measure records ledger', meas.status === 200 && meas.json?.ledger?.id, `ledgerId=${meas.json?.ledger?.id}`);

  // 7. persistence round-trip: mission aggregates reflect revenue + cost
  const gm = await api('GET', `/api/revenue-operator/missions/${missionId}`);
  const mission = gm.json?.mission;
  check('mission aggregates recomputed (revenue=100 cost=20 net=80)',
    mission?.realizedRevenue === 100 && mission?.actualCost === 20 && mission?.netRevenue === 80,
    `realized=${mission?.realizedRevenue} cost=${mission?.actualCost} net=${mission?.netRevenue}`);

  // 8. experiment status after decide+measure
  const ge = await api('GET', `/api/revenue-operator/experiments/${expId}`);
  check('experiment status APPROVED after GO', ge.json?.experiment?.status === 'APPROVED', `status=${ge.json?.experiment?.status}`);

  console.log(`\nM5_DETERMINISTIC: ${results.filter(r => r.ok).length}/${results.length} passed`);

  // 9. LIVE discover (Hermes dispatch through canonical path)
  console.log('\n--- LIVE DISCOVER (Hermes canonical dispatch) ---');
  const t0 = Date.now();
  const disc = await api('POST', '/api/revenue-engine/digital-products/discover', { missionId, count: 2 });
  const dt = Date.now() - t0;
  console.log(`discover status=${disc.status} elapsed=${(dt / 1000).toFixed(1)}s`);
  const discovered = disc.json?.experiments || [];
  console.log(`discovered experiments: ${discovered.length}`);
  for (const x of discovered) console.log(`  - ${x.id} | ${x.hypothesis} | ${x.status} | ${x.evidence?.length ?? 0} evidence entries`);
  console.log(`dispatch: ok=${disc.json?.dispatch?.ok} worker run=${disc.json?.dispatch?.runId} verdict=${disc.json?.dispatch?.verdict} error=${disc.json?.dispatch?.error ?? 'none'}`);
  check('LIVE discover created experiments', disc.status === 201 && discovered.length > 0, `${discovered.length} experiments created`);
  check('LIVE discover canonical run linked', !!disc.json?.dispatch?.runId, `runId=${disc.json?.dispatch?.runId}`);

  const total = results.filter(r => r.ok).length;
  console.log(`\nM5_RUNTIME_VERIFY: ${total}/${results.length} passed`);
  process.exit(total === results.length ? 0 : 1);
}

main().catch((err) => { console.error('FATAL', err); process.exit(2); });
