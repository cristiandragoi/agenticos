/* Inspect ARGUS acceptance-2 correction goals: status + last events. */
const BASE = process.env.CODEX_API_BASE || 'http://127.0.0.1:4001';
const goalId = process.argv[2] || 'goal-e0c67690-';
(async () => {
  const defects = await (await fetch(`${BASE}/api/argus/defects`)).json();
  const my = (defects.defects || []).filter(d => d.goalId === goalId);
  console.log(`defects for ${goalId}: ${my.length}`);
  for (const d of my) {
    console.log(`\nDEFECT ${d.id} severity=${d.severity} status=${d.status} correctionGoalId=${d.correctionGoalId}`);
    console.log(`  desc: ${(d.description || '').slice(0, 200)}`);
    if (d.correctionGoalId) {
      const g = await (await fetch(`${BASE}/api/chat/agents/goal/${d.correctionGoalId}`)).json();
      console.log(`  correction goal ${d.correctionGoalId}: status=${g.status} verificationState=${g.verificationState}`);
      console.log(`  executionOptions=${JSON.stringify(g.executionOptions || {}).slice(0, 300)}`);
      const hist = (g.history || []).slice(-6).map(e => `    [${e.eventType}] ${(e.message || '').slice(0, 160)}`);
      hist.forEach(h => console.log(h));
    }
  }
  const vs = await (await fetch(`${BASE}/api/argus/goals/${goalId}`)).json();
  console.log(`\nverifications: ${(vs.verifications || []).length}`);
  (vs.verifications || []).forEach(v => {
    console.log(`  ${v.id} attempt=${v.attempt} status=${v.status} evidence=${v.evidenceLevel} created=${v.createdAt} completed=${v.completedAt}`);
  });
})().catch(e => { console.error('FATAL', e); process.exit(1); });
