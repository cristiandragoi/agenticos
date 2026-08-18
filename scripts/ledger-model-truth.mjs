// Extract the model-truth fields from a RunLedger record.
const id = process.argv[2];
const j = await (await fetch(`http://localhost:4000/api/run-ledger/${id}`)).json();
const r = j.run || {};
console.log(JSON.stringify({
  taskId: r.taskId,
  workerType: r.workerType,
  status: r.status,
  verificationState: r.verificationState,
  assignedProvider: r.assignedProvider,
  assignedModel: r.assignedModel,
  effectiveProvider: r.effectiveProvider,
  effectiveModel: r.effectiveModel,
  gateResults: (r.gateResults || []).map((g) => `${g.gateId}:${g.status}`),
}, null, 1));
