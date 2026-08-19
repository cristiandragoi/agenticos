// M2/M3 — verify Revenue Operator backend domain end-to-end on the dev backend.
const BASE = process.env.RO_BACKEND || 'http://127.0.0.1:4001';

(async () => {
  const j = async (r) => { const b = await r.json(); return { status: r.status, body: b }; };

  // 1. Create mission
  const m = await j(await fetch(`${BASE}/api/revenue-operator/missions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'RO1 domain verify', targetAmount: 300, startDate: '2026-08-19', deadline: '2026-09-18', enabledEngines: ['digital_products', 'german_sme'], availableChannels: ['SHOPIFY', 'DIRECT_OUTREACH'] }),
  }));
  console.log('CREATE_MISSION', m.status, m.body.mission?.id);
  const missionId = m.body.mission?.id;

  // 2. Create experiment
  const e = await j(await fetch(`${BASE}/api/revenue-operator/experiments`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ missionId, engine: 'digital_products', hypothesis: 'Freelancers buy a cashflow template at €19', targetCustomer: 'freelancers', problem: 'cashflow tracking', product: 'Freelancer Cashflow Toolkit', offer: '€19 template', price: 19, expectedRevenue: 300, estimatedCost: 5, distributionChannels: ['SHOPIFY'] }),
  }));
  console.log('CREATE_EXPERIMENT', e.status, e.body.experiment?.id, 'status=' + e.body.experiment?.status);
  const expId = e.body.experiment?.id;

  // 3. Evidence (classification FACT with source)
  const ev = await j(await fetch(`${BASE}/api/revenue-operator/experiments/${expId}/evidence`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ classification: 'FACT', title: 'Shopify marketplace demand', source: 'shopify-search', summary: 'Observed 3 competing cashflow templates with reviews', confidence: 0.8, provenance: 'manual market scan 2026-08-19' }),
  }));
  console.log('ADD_EVIDENCE', ev.status, ev.body.evidence?.classification);

  // 4. Score
  const sc = await j(await fetch(`${BASE}/api/revenue-operator/experiments/${expId}/score`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ demand: 0.7, purchaseIntent: 0.6, expectedMargin: 0.8, distributionProbability: 0.7, automationPotential: 0.9, competitiveAdvantage: 0.5, buildTime: 0.3, acquisitionDifficulty: 0.4, capitalRequirement: 0.2, risk: 0.3 }),
  }));
  console.log('SCORE', sc.status, 'overall=' + sc.body.score?.overallScore, 'conf=' + sc.body.score?.confidence);

  // 5. Transition lifecycle VALIDATING -> APPROVED -> BUILDING
  const t1 = await j(await fetch(`${BASE}/api/revenue-operator/experiments/${expId}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'VALIDATING' }) }));
  const t2 = await j(await fetch(`${BASE}/api/revenue-operator/experiments/${expId}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'APPROVED' }) }));
  const t3 = await j(await fetch(`${BASE}/api/revenue-operator/experiments/${expId}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'BUILDING' }) }));
  console.log('TRANSITIONS', t1.status, t2.status, t3.status, '→', t3.body.experiment?.status);

  // 6. Invalid transition should 400 (BUILDING -> LIVE is invalid)
  const bad = await j(await fetch(`${BASE}/api/revenue-operator/experiments/${expId}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'LIVE' }) }));
  console.log('INVALID_TRANSITION', bad.status, bad.body.error);

  // 7. Ledger: PIPELINE_VALUE (no evidence needed) + REALIZED_REVENUE + VERIFIED_REVENUE (evidence REQUIRED)
  const l1 = await j(await fetch(`${BASE}/api/revenue-operator/ledger`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ missionId, experimentId: expId, entryType: 'PIPELINE_VALUE', amount: 120 }) }));
  console.log('LEDGER_PIPELINE', l1.status, l1.body.entry?.entryType);
  const l2 = await j(await fetch(`${BASE}/api/revenue-operator/ledger`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ missionId, experimentId: expId, entryType: 'REALIZED_REVENUE', amount: 19 }) }));
  console.log('LEDGER_REALIZED', l2.status, l2.body.entry?.entryType);
  // VERIFIED without evidence -> must 400
  const lBad = await j(await fetch(`${BASE}/api/revenue-operator/ledger`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ missionId, entryType: 'VERIFIED_REVENUE', amount: 19 }) }));
  console.log('LEDGER_VERIFIED_NO_EVIDENCE', lBad.status, lBad.body.error);
  // VERIFIED with evidence -> ok
  const l3 = await j(await fetch(`${BASE}/api/revenue-operator/ledger`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ missionId, experimentId: expId, entryType: 'VERIFIED_REVENUE', amount: 19, evidence: [{ classification: 'FACT', title: 'Shopify order', source: 'shopify', summary: 'Order #1234 paid', confidence: 1, provenance: 'shopify admin export' }] }) }));
  console.log('LEDGER_VERIFIED_EVIDENCE', l3.status, l3.body.entry?.status);

  // 8. Mission aggregates recomputed
  const agg = await j(await fetch(`${BASE}/api/revenue-operator/missions/${missionId}/recompute`, { method: 'POST' }));
  console.log('AGGREGATES', agg.status, JSON.stringify(agg.body.aggregates));

  // 9. Human gate + resolve
  const g = await j(await fetch(`${BASE}/api/revenue-operator/gates`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ experimentId: expId, gateType: 'SHOPIFY_AUTH_REQUIRED', description: 'Shopify OAuth required before publish', branchPaused: true }) }));
  console.log('CREATE_GATE', g.status, g.body.gate?.id, 'paused=' + g.body.gate?.branchPaused);
  const gr = await j(await fetch(`${BASE}/api/revenue-operator/gates/${g.body.gate?.id}/resolve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resolvedBy: 'user' }) }));
  console.log('RESOLVE_GATE', gr.status, gr.body.gate?.status);

  // 10. Compliance record
  const c = await j(await fetch(`${BASE}/api/revenue-operator/compliance`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ experimentId: expId, companyName: 'Test GmbH', website: 'https://test.example', contactSource: 'website', businessRelevance: 'automation candidate', lawfulBasis: 'legitimate_interest' }) }));
  console.log('CREATE_COMPLIANCE', c.status, c.body.compliance?.id, 'state=' + c.body.compliance?.suppressionState);

  // 11. Observability
  const o = await j(await fetch(`${BASE}/api/revenue-operator/observability/${missionId}`));
  console.log('OBSERVABILITY', o.status, 'running=' + JSON.stringify(o.body.whatIsRunning), 'blocked=' + JSON.stringify(o.body.whatIsBlocked));

  // 12. Link canonical goal id
  const link = await j(await fetch(`${BASE}/api/revenue-operator/experiments/${expId}/link`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'goal', refId: 'goal-27a965ae-' }) }));
  console.log('LINK_GOAL', link.status, JSON.stringify(link.body.experiment?.goalIds));

  console.log('DOMAIN_VERIFY_DONE');
})().catch((e) => { console.error('DOMAIN_VERIFY_ERROR', e.message); process.exit(1); });
