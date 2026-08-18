// Hermes FAILING-gate E2E: real Hermes execution, required gate fails → must NOT complete.
const API = 'http://localhost:4000/api';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const create = await fetch(`${API}/background-tasks`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    title: 'Hermes gate FAIL E2E — required gate must block completion',
    objective: 'Inspect the AgenticOS repository at B:\\AgenticOS. Report the project name from package.json in one sentence. Do NOT modify any files.',
    worker: 'hermes',
    selectedAgent: 'Hermes',
    projectId: 'proj-ac4c89f0',
    workspacePath: 'B:/AgenticOS',
    metadata: {
      gates: [
        { type: 'file-exists', id: 'impossible-gate', path: 'THIS_FILE_DOES_NOT_EXIST_GATE_FAIL_TEST.txt', required: true },
      ],
    },
  }),
});
const task = await create.json();
console.log('CREATED ' + JSON.stringify({ taskId: task.taskId, status: task.status, worker: task.worker }));

let last = null;
const seen = new Set();
let verifyingCapture = null;
for (let i = 0; i < 200; i++) {
  await sleep(3000);
  const t = await (await fetch(`${API}/background-tasks/${task.taskId}`)).json();
  const key = `${t.status}:${t.verificationState}:${t.progressMessage || ''}`;
  if (!seen.has(key)) { seen.add(key); console.log('STATE ' + new Date().toISOString().slice(11, 19) + ' ' + key.slice(0, 110)); }
  if (t.status === 'verifying' && !verifyingCapture) {
    const rt = await (await fetch(`${API}/jarvis/runtime-state`)).json();
    verifyingCapture = { state: rt.state, activeAgent: rt.activeAgent, activeTask: rt.activeTask };
  }
  last = t;
  if (['completed', 'failed', 'cancelled', 'blocked'].includes(t.status)) break;
}
console.log('VERIFYING_CAPTURE ' + JSON.stringify(verifyingCapture));
console.log('FINAL ' + JSON.stringify({
  taskId: last.taskId, status: last.status, verificationState: last.verificationState,
  linkedRunId: last.linkedRunId, blocker: last.blocker,
  gateResults: (last.metadata?.gateResults || []).map((g) => ({ gateId: g.gateId, status: g.status, reason: (g.reason || '').slice(0, 90) })),
}));
const ledger = await (await fetch(`${API}/run-ledger/${last.taskId}`)).json();
console.log('LEDGER ' + JSON.stringify({
  status: ledger.run?.status, verificationState: ledger.run?.verificationState,
  assignedProvider: ledger.run?.assignedProvider, effectiveModel: ledger.run?.effectiveModel,
  gateResults: ledger.run?.gateResults?.map((g) => `${g.gateId}:${g.status}`),
  evidence: ledger.evidence?.map((e) => e.kind),
}));
const rt2 = await (await fetch(`${API}/jarvis/runtime-state`)).json();
console.log('JARVIS_AFTER ' + JSON.stringify({ state: rt2.state, activeTask: rt2.activeTask }));
console.log('INVARIANT ' + (last.status !== 'completed' ? 'HOLD (not completed despite failed gate)' : 'VIOLATED (completed despite failed gate)'));
