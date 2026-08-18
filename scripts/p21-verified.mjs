// P21 E2E: a real CodeX change task with required gates → verified completion.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const API = 'http://localhost:4000/api';

// 1. create the gated task (safe tiny change outside avatar code)
const create = await fetch(`${API}/background-tasks`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    title: 'Add a small targeted test for the formatContinuation helper in projectMemory.ts.',
    objective: 'Review the current AgenticOS project and add a small targeted test for the formatContinuation helper in server/src/domains/jarvis/projectMemory.ts. Do not modify anything else. Do not touch avatar or visualization code.',
    worker: 'codex',
    selectedAgent: 'CodeX',
    projectId: 'proj-ac4c89f0',
    workspacePath: 'B:/AgenticOS',
    metadata: {
      gates: [
        { type: 'command', id: 'targeted-tests', command: 'npx vitest run server/src/__tests__/projectMemory.test.ts', required: true, timeoutMs: 240000 },
        { type: 'build', id: 'server-build', command: 'npm run build --prefix server', required: true, timeoutMs: 240000 },
      ],
    },
  }),
});
const task = await create.json();
console.log('CREATED ' + JSON.stringify({ taskId: task.taskId, status: task.status, projectId: task.projectId }));

// 2. poll the lifecycle through verification
let last = null;
const seen = new Set();
for (let i = 0; i < 40; i++) {
  await sleep(10000);
  const t = await (await fetch(`${API}/background-tasks/${task.taskId}`)).json();
  const key = `${t.status}:${t.verificationState}:${t.progressMessage || ''}`;
  if (!seen.has(key)) { seen.add(key); console.log('STATE ' + new Date().toISOString().slice(11, 19) + ' ' + key.slice(0, 90)); }
  // capture the VERIFYING window for the ACTIVE RUN truth
  if (t.status === 'verifying') {
    const rt = await (await fetch(`${API}/jarvis/runtime-state`)).json();
    console.log('ACTIVE_RUN_DURING_VERIFY ' + JSON.stringify({ state: rt.state, activeAgent: rt.activeAgent, activeTask: rt.activeTask }));
  }
  last = t;
  if (['completed', 'failed', 'cancelled', 'blocked'].includes(t.status)) break;
}
console.log('FINAL ' + JSON.stringify({
  taskId: last.taskId, status: last.status, verificationState: last.verificationState,
  blocker: last.blocker, progressMessage: last.progressMessage,
  gateResults: (last.metadata?.gateResults || []).map((g) => ({ gateId: g.gateId, status: g.status, attempt: g.attempt, exitCode: g.exitCode })),
}));

// 3. RunLedger record
const ledger = await (await fetch(`${API}/run-ledger/${last.taskId}`)).json();
console.log('LEDGER ' + JSON.stringify({
  run: { runId: ledger.run?.runId, taskId: ledger.run?.taskId, status: ledger.run?.status, verificationState: ledger.run?.verificationState, gateResults: ledger.run?.gateResults?.map((g) => `${g.gateId}:${g.status}`) },
  evidence: ledger.evidence?.map((e) => e.kind).slice(-8),
}));
