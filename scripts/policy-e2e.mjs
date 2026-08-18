// Stage 2 live E2E: project policy enforcement.
// 1. policy API round-trip + contradiction rejection
// 2. localOnly project → Hermes dispatch BLOCKED before any cloud send
// 3. localOnly project → CodeX runs WITHOUT cloud escalation (escalationModel null)
// 4. RunLedger reports policy truth
const API = 'http://localhost:4000/api';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1. create a test project + set strict policy
const proj = await (await fetch(`${API}/projects`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'Policy E2E project' }),
})).json();
console.log('PROJECT ' + JSON.stringify({ id: proj.id, name: proj.name }));

const setRes = await fetch(`${API}/projects/${proj.id}/policy`, {
  method: 'PUT', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ privacy: 'sensitive', runtime: 'localOnly', cloudEscalation: 'forbidden' }),
});
console.log('POLICY_SET http=' + setRes.status + ' ' + JSON.stringify(await setRes.json()));

const getRes = await (await fetch(`${API}/projects/${proj.id}/policy`)).json();
console.log('POLICY_GET ' + JSON.stringify(getRes.policy));

// contradiction must be rejected with 400
const badRes = await fetch(`${API}/projects/${proj.id}/policy`, {
  method: 'PUT', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ privacy: 'internal', runtime: 'localOnly', cloudEscalation: 'allowed' }),
});
console.log('POLICY_CONTRADICTION http=' + badRes.status + ' ' + JSON.stringify(await badRes.json()));

// 2. Hermes task in localOnly project → must be blocked BEFORE cloud send
const hTask = await (await fetch(`${API}/background-tasks`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    title: 'Policy E2E — hermes must be blocked',
    objective: 'Report the AgenticOS project name.',
    worker: 'hermes', selectedAgent: 'Hermes',
    projectId: proj.id, workspacePath: 'B:/AgenticOS',
  }),
})).json();
console.log('HERMES_TASK ' + JSON.stringify({ taskId: hTask.taskId }));
await sleep(8000);
const hState = await (await fetch(`${API}/background-tasks/${hTask.taskId}`)).json();
console.log('HERMES_FINAL ' + JSON.stringify({
  status: hState.status, blocker: hState.blocker, linkedRunId: hState.linkedRunId,
  policy: hState.metadata?.policy,
}));
const hRuns = await (await fetch(`${API}/hermes-api/runs`)).json();
console.log('HERMES_RUNS_CREATED ' + (Array.isArray(hRuns) ? hRuns.filter((r) => String(r.prompt || '').includes('Policy E2E')).length : 'n/a'));

// 3. CodeX task in localOnly project → runs, escalation suppressed
const cTask = await (await fetch(`${API}/background-tasks`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    title: 'Policy E2E — codex local-only',
    objective: 'Say exactly: policy-ok. Do not modify any files.',
    worker: 'codex', selectedAgent: 'CodeX',
    projectId: proj.id, workspacePath: 'B:/AgenticOS',
  }),
})).json();
console.log('CODEX_TASK ' + JSON.stringify({ taskId: cTask.taskId }));
let cState = null;
const seen = new Set();
for (let i = 0; i < 40; i++) {
  await sleep(6000);
  cState = await (await fetch(`${API}/background-tasks/${cTask.taskId}`)).json();
  const key = `${cState.status}:${cState.progressMessage || ''}`;
  if (!seen.has(key)) { seen.add(key); console.log('CODEX_STATE ' + new Date().toISOString().slice(11, 19) + ' ' + key.slice(0, 100)); }
  if (['completed', 'failed', 'cancelled', 'blocked'].includes(cState.status)) break;
}
console.log('CODEX_FINAL ' + JSON.stringify({
  status: cState.status, policy: cState.metadata?.policy, resultHead: String(cState.resultText || '').slice(0, 120),
}));

// 4. RunLedger policy truth for the CodeX run
const ledger = await (await fetch(`${API}/run-ledger/${cTask.taskId}`)).json();
console.log('LEDGER_POLICY ' + JSON.stringify({
  policy: ledger.run?.policy, escalationOccurred: ledger.run?.escalationOccurred,
  assignedProvider: ledger.run?.assignedProvider, effectiveModel: ledger.run?.effectiveModel,
}));
