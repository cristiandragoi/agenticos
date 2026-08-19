// test-m6-runtime.cjs — M6 German SME Engine runtime verification against :4001.
const BASE = 'http://127.0.0.1:4001';
const results = [];
function check(name, ok, evidence) {
  results.push({ name, ok });
  console.log(`${ok ? '[PASS]' : '[FAIL]'} ${name} — ${evidence}`);
}
async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
  });
  let json = null; try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

async function main() {
  const stamp = Date.now().toString(36);

  // 1. Mission + german_sme experiment
  const m = await api('POST', '/api/revenue-operator/missions', {
    title: `M6 runtime verify ${stamp}`, targetAmount: 300, currency: 'EUR',
    startDate: '2026-08-19', deadline: '2026-09-18', enabledEngines: ['german_sme'],
  });
  const missionId = m.json?.mission?.id;
  check('create mission', m.status === 201 && !!missionId, `id=${missionId}`);

  const e = await api('POST', '/api/revenue-operator/experiments', {
    missionId, engine: 'german_sme', hypothesis: 'Muster GmbH (manufacturing SME)',
    problem: 'Manual quoting and document processing', product: 'AI automation offer',
  });
  const expId = e.json?.experiment?.id;
  check('create german_sme experiment', e.status === 201 && e.json?.experiment?.status === 'DISCOVERED', `status=${e.json?.experiment?.status}`);

  // 2. next-action for german_sme → inspect
  const na = await api('GET', `/api/revenue-engine/experiments/${expId}/next-action`);
  check('sme next-action DISCOVERED→inspect', na.json?.nextAction === 'inspect' && na.json?.engine === 'german_sme', `nextAction=${na.json?.nextAction}`);

  // 3. qualify (score + decide, no worker) → APPROVED (GO)
  const q = await api('POST', `/api/revenue-engine/experiments/${expId}/qualify`, {
    inputs: { demand: 0.7, purchaseIntent: 0.6, expectedMargin: 0.8, distributionProbability: 0.5, automationPotential: 0.9, competitiveAdvantage: 0.4, buildTime: 0.3, acquisitionDifficulty: 0.4, capitalRequirement: 0.2, risk: 0.3 },
  });
  check('qualify → GO (APPROVED)', q.json?.go === true && q.json?.to === 'APPROVED', `to=${q.json?.to}`);

  // 4. gate-outreach → QA + OUTBOUND_APPROVAL gate
  const g = await api('POST', `/api/revenue-engine/experiments/${expId}/gate-outreach`, { description: 'Approve outreach to Muster GmbH' });
  const gateId = g.json?.gate?.id;
  check('gate-outreach creates OUTBOUND_APPROVAL gate', g.status === 201 && g.json?.gate?.gateType === 'OUTBOUND_APPROVAL' && g.json?.gate?.status === 'open', `gateType=${g.json?.gate?.gateType}`);

  // 5. record-outreach while gate open → BLOCKED (409)
  const blocked = await api('POST', `/api/revenue-engine/experiments/${expId}/record-outreach`, { channel: 'email' });
  check('outreach blocked while gate open (409)', blocked.status === 409, `status=${blocked.status}`);

  // 6. resolve gate (human approval)
  const resolved = await api('POST', `/api/revenue-operator/gates/${gateId}/resolve`, { resolvedBy: 'human-operator' });
  check('gate resolved', resolved.json?.gate?.status === 'resolved', `status=${resolved.json?.gate?.status}`);

  // 7. record-outreach after resolution → PUBLISHING
  const ro = await api('POST', `/api/revenue-engine/experiments/${expId}/record-outreach`, { channel: 'email', note: 'Initial inquiry' });
  check('record-outreach → PUBLISHING', ro.json?.experiment?.status === 'PUBLISHING', `status=${ro.json?.experiment?.status}`);

  // 8. record-outcome WON with revenue → WON + ledger
  const oc = await api('POST', `/api/revenue-engine/experiments/${expId}/record-outcome`, { won: true, amount: 150 });
  check('record-outcome WON', oc.json?.experiment?.status === 'WON', `status=${oc.json?.experiment?.status}`);
  check('WON recorded realized revenue', !!oc.json?.ledger?.id, `ledgerId=${oc.json?.ledger?.id}`);

  // 9. mission aggregates reflect the €150 win
  const gm = await api('GET', `/api/revenue-operator/missions/${missionId}`);
  check('mission realizedRevenue=150 after win', gm.json?.mission?.realizedRevenue === 150, `realized=${gm.json?.mission?.realizedRevenue}`);

  const total = results.filter(r => r.ok).length;
  console.log(`\nM6_RUNTIME_VERIFY: ${total}/${results.length} passed`);
  process.exit(total === results.length ? 0 : 1);
}
main().catch((err) => { console.error('FATAL', err); process.exit(2); });
