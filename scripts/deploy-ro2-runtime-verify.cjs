/* RO2 deploy: packaged runtime verification on :4000 — new trace endpoints + regression probes */
const BASE = 'http://localhost:4000';
let missionId = null;
async function j(path) {
  const r = await fetch(BASE + path);
  const body = await r.json().catch(() => null);
  return { status: r.status, body };
}
(async () => {
  const health = await j('/api/health');
  console.log(`[${health.status}] health:`, JSON.stringify(health.body).slice(0, 120));

  const missions = await j('/api/revenue-operator/missions');
  missionId = missions.body?.missions?.[0]?.id;
  console.log(`[${missions.status}] missions:`, missions.body?.missions?.length, 'first:', missionId);
  if (!missionId) { console.log('NO MISSION — abort'); process.exit(1); }

  const probes = [
    `/api/revenue-operator/missions/${missionId}/trace`,
    `/api/revenue-operator/missions/${missionId}/kpi/target`,
    `/api/revenue-operator/missions/${missionId}/kpi/realized`,
    `/api/revenue-operator/missions/${missionId}/kpi/verified`,
    `/api/revenue-operator/missions/${missionId}/kpi/pipeline`,
    `/api/revenue-operator/missions/${missionId}/kpi/cost`,
    `/api/revenue-operator/missions/${missionId}/kpi/net`,
    `/api/revenue-operator/missions/${missionId}/kpi/adSpend`,
    `/api/revenue-operator/missions/${missionId}/board/digital_products`,
    `/api/revenue-operator/missions/${missionId}/board/german_sme`,
    `/api/revenue-operator/missions/${missionId}/board/pipeline`,
    `/api/revenue-operator/missions/${missionId}/live-execution`,
    `/api/revenue-operator/gates/queue`,
    `/api/revenue-operator/gates/queue?status=open`,
    `/api/revenue-operator/observability/${missionId}`,
    `/api/revenue-operator/ledger`,
    `/api/revenue-operator/experiments`,
    `/api/revenue-engine/distribution`,
    `/api/argus/contracts`,
    `/api/argus/assignment`,
  ];
  let fail = 0;
  for (const p of probes) {
    const r = await j(p);
    const ok = r.status === 200;
    if (!ok) fail++;
    const size = JSON.stringify(r.body).length;
    console.log(`[${r.status}] ${p} (${size}b)`);
  }
  // invalid engine must 400
  const bad = await j(`/api/revenue-operator/missions/${missionId}/board/bogus`);
  console.log(`[${bad.status}] board/bogus (expect 400)`);
  if (bad.status !== 400) fail++;
  // bad kpi must 400
  const badKpi = await j(`/api/revenue-operator/missions/${missionId}/kpi/bogus`);
  console.log(`[${badKpi.status}] kpi/bogus (expect 400)`);
  if (badKpi.status !== 400) fail++;

  // content checks
  const trace = await j(`/api/revenue-operator/missions/${missionId}/trace`);
  console.log('trace kpis:', Object.keys(trace.body.kpis).join(','));
  const dp = await j(`/api/revenue-operator/missions/${missionId}/board/digital_products`);
  console.log('dp columns:', dp.body.columns.map(c => c.key).join(' > '));
  console.log('dp placed/total:', dp.body.placed, '/', dp.body.total);
  const live = await j(`/api/revenue-operator/missions/${missionId}/live-execution`);
  console.log('live rows:', live.body.rows?.length, 'note:', live.body.note || 'none');

  console.log(fail === 0 ? 'RO2 RUNTIME: ALL PASS' : `RO2 RUNTIME: ${fail} FAILURES`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
