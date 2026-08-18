// REAL HERMES E2E: Hermes execution → VERIFYING → gates → completion → RunLedger → Jarvis truth.
const API = 'http://localhost:4000/api';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1. create a REAL Hermes task with required gates (read-only objective)
const create = await fetch(`${API}/background-tasks`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    title: 'Hermes gate E2E — inspect AgenticOS package.json + runLedger presence',
    objective: 'Inspect the AgenticOS repository at B:\\AgenticOS. Report the project name and version from package.json, and confirm whether server/src/services/runLedger.ts exists. Do NOT modify any files. Answer in 3 sentences.',
    worker: 'hermes',
    selectedAgent: 'Hermes',
    projectId: 'proj-ac4c89f0',
    workspacePath: 'B:/AgenticOS',
    metadata: {
      gates: [
        { type: 'file-exists', id: 'repo-integrity', path: 'package.json', required: true },
        { type: 'command', id: 'targeted-tests', command: 'npx vitest run server/src/__tests__/projectMemory.test.ts', required: true, timeoutMs: 240000 },
      ],
    },
  }),
});
const task = await create.json();
console.log('CREATED ' + JSON.stringify({ taskId: task.taskId, status: task.status, worker: task.worker, projectId: task.projectId }));

// 2. poll the full lifecycle through VERIFYING (fast poll to catch it live)
let last = null;
const seen = new Set();
let verifyingCapture = null;
for (let i = 0; i < 200; i++) {
  await sleep(3000);
  const t = await (await fetch(`${API}/background-tasks/${task.taskId}`)).json();
  const key = `${t.status}:${t.verificationState}:${t.progressMessage || ''}`;
  if (!seen.has(key)) { seen.add(key); console.log('STATE ' + new Date().toISOString().slice(11, 19) + ' ' + key.slice(0, 100)); }
  if (t.status === 'verifying' && !verifyingCapture) {
    const rt = await (await fetch(`${API}/jarvis/runtime-state`)).json();
    verifyingCapture = { state: rt.state, activeAgent: rt.activeAgent, activeTask: rt.activeTask };
  }
  last = t;
  if (['completed', 'failed', 'cancelled', 'blocked'].includes(t.status)) break;
}

console.log('ACTIVE_RUN_DURING_VERIFYING ' + JSON.stringify(verifyingCapture));
console.log('FINAL ' + JSON.stringify({
  taskId: last.taskId, status: last.status, verificationState: last.verificationState,
  linkedRunId: last.linkedRunId, blocker: last.blocker, progressMessage: last.progressMessage,
  gateResults: (last.metadata?.gateResults || []).map((g) => ({ gateId: g.gateId, status: g.status, attempt: g.attempt, exitCode: g.exitCode ?? null, reason: (g.reason || '').slice(0, 80) })),
  resultHead: String(last.resultText || '').slice(0, 220),
}));

// 3. RunLedger record (model truth now from the hermes run record)
const ledger = await (await fetch(`${API}/run-ledger/${last.taskId}`)).json();
console.log('LEDGER ' + JSON.stringify({
  run: {
    runId: ledger.run?.runId, taskId: ledger.run?.taskId, workerType: ledger.run?.workerType,
    status: ledger.run?.status, verificationState: ledger.run?.verificationState,
    assignedProvider: ledger.run?.assignedProvider, assignedModel: ledger.run?.assignedModel,
    effectiveProvider: ledger.run?.effectiveProvider, effectiveModel: ledger.run?.effectiveModel,
    gateResults: ledger.run?.gateResults?.map((g) => `${g.gateId}:${g.status}`),
  },
  evidence: ledger.evidence?.map((e) => e.kind),
}));

// 4. Jarvis user-facing truth — runtime-state + recent events
const rt2 = await (await fetch(`${API}/jarvis/runtime-state`)).json();
console.log('JARVIS_TRUTH_AFTER ' + JSON.stringify({ state: rt2.state, activeTask: rt2.activeTask }));
const events = await (await fetch(`${API}/jarvis/live-events?limit=15`)).json();
console.log('LIVE_EVENTS ' + JSON.stringify((Array.isArray(events) ? events : []).filter((e) => e.taskId === last.taskId).map((e) => `${e.kind}:${(e.summary || '').slice(0, 60)}`)));
