// test-m7-m15-runtime.cjs — M7 Shopify gate + M15 bounded E2E mission.
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
  // ── M7: Shopify gate ──────────────────────────────────────────────────────
  const dist = await api('GET', '/api/revenue-engine/distribution');
  const shopify = (dist.json?.channels || []).find((c) => c.channel === 'SHOPIFY');
  check('SHOPIFY channel present, auth_required', shopify?.status === 'auth_required' && shopify?.humanGateRequired === true, `status=${shopify?.status}`);

  const m = await api('POST', '/api/revenue-operator/missions', {
    title: `M7 publish gate ${Date.now().toString(36)}`, targetAmount: 300, currency: 'EUR',
    startDate: '2026-08-19', deadline: '2026-09-18',
  });
  const missionId = m.json?.mission?.id;
  const e = await api('POST', '/api/revenue-operator/experiments', {
    missionId, engine: 'digital_products', hypothesis: 'Checklist pack', product: 'Checklist pack',
  });
  const expId = e.json?.experiment?.id;

  const pub = await api('POST', `/api/revenue-engine/experiments/${expId}/publish`, { channel: 'SHOPIFY' });
  check('SHOPIFY publish blocked (no fake publication)', pub.json?.published === false && pub.json?.blocked === true && pub.json?.gate?.gateType === 'SHOPIFY_AUTH_REQUIRED', `blocked=${pub.json?.blocked} reason=${pub.json?.reason}`);

  // ── M15: bounded E2E mission ──────────────────────────────────────────────
  console.log('\n--- M15 bounded E2E mission (Hermes strategy + discovery) ---');
  const t0 = Date.now();
  const e2e = await api('POST', '/api/revenue-engine/e2e/run', {});
  const dt = Date.now() - t0;
  console.log(`e2e status=${e2e.status} elapsed=${(dt / 1000).toFixed(1)}s`);
  const tr = e2e.json;
  console.log(`trace.status=${tr?.status} mission=${tr?.missionId} experiment=${tr?.experimentId} experimentStatus=${tr?.experimentStatus} nextAction=${tr?.nextAction}`);
  console.log(`strategy run=${tr?.strategyRunId} verdict=${tr?.strategyVerdict} | result run=${tr?.resultRunId} verdict=${tr?.resultVerdict}`);
  console.log('steps:');
  for (const s of (tr?.steps || [])) console.log(`  ${s.ok ? '✓' : '✗'} ${s.step} — ${s.detail}`);
  check('E2E mission persisted + experiment APPROVED', tr?.status === 'success' && tr?.experimentStatus === 'APPROVED', `status=${tr?.status} expStatus=${tr?.experimentStatus}`);
  check('E2E canonical run linked (strategy + result)', !!tr?.strategyRunId && !!tr?.resultRunId, `strategyRun=${tr?.strategyRunId} resultRun=${tr?.resultRunId}`);
  check('E2E next action = build', tr?.nextAction === 'build', `nextAction=${tr?.nextAction}`);

  const total = results.filter(r => r.ok).length;
  console.log(`\nM7_M15_RUNTIME_VERIFY: ${total}/${results.length} passed`);
  process.exit(total === results.length ? 0 : 1);
}
main().catch((err) => { console.error('FATAL', err); process.exit(2); });
