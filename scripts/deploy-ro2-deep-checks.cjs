/* RO2 deploy: deep content checks — live rows truthful, experiment trace, drill-down links */
const BASE = 'http://localhost:4000';
(async () => {
  const missions = await (await fetch(`${BASE}/api/revenue-operator/missions`)).json();
  const mid = missions.missions[0].id;

  // live execution rows: statuses must be real DB statuses; elapsed present
  const live = await (await fetch(`${BASE}/api/revenue-operator/missions/${mid}/live-execution`)).json();
  console.log('LIVE ROWS:');
  for (const r of live.rows) {
    console.log(`  ${r.runId.slice(0, 14)} | ${r.executor} | ${r.provider}/${r.model} | status=${r.status} | elapsed=${r.elapsedMs}ms | verdict=${r.verification?.verdict ?? 'none'} | argus=${r.argus?.verificationState ?? '—'} | next=${r.nextAction ?? '—'}`);
    if (!['queued', 'running', 'completed', 'failed', 'stopped', 'cancelled', 'awaiting_review'].includes(r.status)) {
      console.log('  !! unexpected status value');
    }
  }

  // experiment trace on the real E2E experiment
  const exps = await (await fetch(`${BASE}/api/revenue-operator/experiments?missionId=${mid}`)).json();
  const exp = exps.experiments[0];
  const t = await (await fetch(`${BASE}/api/revenue-operator/experiments/${exp.id}/trace`)).json();
  console.log('\nEXPERIMENT TRACE', exp.id);
  console.log('  status:', t.experiment.status, '| nextAction:', t.nextAction, '| argus:', t.argusState);
  console.log('  events:', t.events.length, '| ledger:', t.ledger.length, '| gates:', t.gates.length, '| runs:', t.runs.length, '| verifications:', t.verifications.length, '| goals:', t.goalStates.length);
  console.log('  evidence:', (t.experiment.evidence || []).length, 'items');

  // KPI pipeline includes board + totals consistent
  const kp = await (await fetch(`${BASE}/api/revenue-operator/missions/${mid}/kpi/pipeline`)).json();
  console.log('\nKPI pipeline: total=', kp.total, 'board columns=', kp.board?.columns?.length, 'placed=', kp.board?.placed);

  // KPI net formula explainable
  const kn = await (await fetch(`${BASE}/api/revenue-operator/missions/${mid}/kpi/net`)).json();
  console.log('KPI net:', kn.formula, '=', kn.realized, '-', kn.cost, '=', kn.total);

  // ledger trace (empty ledger is fine — but endpoint must 404 cleanly on unknown)
  const bad = await fetch(`${BASE}/api/revenue-operator/ledger/nope/trace`);
  console.log('ledger trace unknown id ->', bad.status, '(expect 404)');
  const badExp = await fetch(`${BASE}/api/revenue-operator/experiments/nope/trace`);
  console.log('experiment trace unknown id ->', badExp.status, '(expect 404)');
})();
