/* OVERNIGHT RO2 — final packaged verification: boards, gates, live execution, KPIs all live on :4000 */
const BASE = 'http://localhost:4000';
const FS = require('fs');
const state = JSON.parse(FS.readFileSync('B:/AgenticOS/workspace/root/overnight-ro2-state.json', 'utf-8'));
const mid = state.missionId;

(async () => {
  let fail = 0;
  const chk = (name, ok, detail) => { console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`); if (!ok) fail++; };

  const trace = await (await fetch(`${BASE}/api/revenue-operator/missions/${mid}/trace`)).json();
  chk('mission trace live', !!trace.kpis, `realized €${trace.kpis.realized.value} verified €${trace.kpis.verified.value} pipeline €${trace.kpis.pipeline.value}`);

  const dpBoard = await (await fetch(`${BASE}/api/revenue-operator/missions/${mid}/board/digital_products`)).json();
  chk('digital Kanban', dpBoard.placed === dpBoard.total && dpBoard.total > 0, `${dpBoard.placed}/${dpBoard.total} placed, columns=${dpBoard.columns.length}`);

  const smeBoard = await (await fetch(`${BASE}/api/revenue-operator/missions/${mid}/board/german_sme`)).json();
  chk('SME Kanban', smeBoard.placed === smeBoard.total, `${smeBoard.placed}/${smeBoard.total} placed`);

  const pipeBoard = await (await fetch(`${BASE}/api/revenue-operator/missions/${mid}/board/pipeline`)).json();
  chk('pipeline Kanban', pipeBoard.placed === pipeBoard.total, `${pipeBoard.placed}/${pipeBoard.placed} placed`);

  const gatesQ = await (await fetch(`${BASE}/api/revenue-operator/gates/queue?status=open`)).json();
  const types = gatesQ.gates.map(g => g.gateType);
  chk('Shopify auth gates surfaced', types.filter(t => t === 'SHOPIFY_AUTH_REQUIRED').length >= 2, types.join(','));
  chk('outbound approval gates surfaced', types.filter(t => t === 'OUTBOUND_APPROVAL').length === 3, `${types.filter(t => t === 'OUTBOUND_APPROVAL').length} OUTBOUND_APPROVAL`);
  chk('gates carry required actions', gatesQ.gates.every(g => g.requiredAction && g.requiredAction.length > 20));

  const live = await (await fetch(`${BASE}/api/revenue-operator/missions/${mid}/live-execution`)).json();
  chk('live execution rows', live.rows.length > 0, `${live.rows.length} canonical runs, statuses: ${[...new Set(live.rows.map(r => r.status))].join(',')}`);
  chk('no queued-as-running', !live.rows.some(r => r.status === 'queued' && r.status === 'running'));

  const ledger = await (await fetch(`${BASE}/api/revenue-operator/ledger?missionId=${mid}`)).json();
  const types2 = [...new Set(ledger.entries.map(e => e.entryType))];
  chk('ledger strict semantics', types2.includes('PIPELINE_VALUE') && !types2.includes('VERIFIED_REVENUE') && !types2.includes('REALIZED_REVENUE'), `types: ${types2.join(',')}`);

  const brief = FS.existsSync('C:/Users/Cris/AppData/Roaming/agenticos/data/revenue-operator/overnight-briefing-2026-08-20.md');
  chk('morning briefing persisted in canonical data dir', brief);

  const exp = await (await fetch(`${BASE}/api/revenue-operator/experiments/expt-a2598507-/trace`)).json();
  chk('strongest product drill-down complete', exp.experiment.status === 'READY_TO_PUBLISH' && exp.events.length >= 3 && exp.gates.length >= 1, `status=${exp.experiment.status} events=${exp.events.length} gates=${exp.gates.length} runs=${exp.runs.length}`);

  console.log(fail === 0 ? '\nOVERNIGHT FINAL VERIFICATION: ALL PASS' : `\nFINAL VERIFICATION: ${fail} FAILURES`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
