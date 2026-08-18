// Raw model-truth audit: task metadata + hermes run record fields.
const taskId = process.argv[2];
const t = await (await fetch(`http://localhost:4000/api/background-tasks/${taskId}`)).json();
const meta = t.metadata || {};
console.log('TASK_METADATA_MODEL ' + JSON.stringify({
  assignedProvider: meta.assignedProvider ?? null,
  assignedModel: meta.assignedModel ?? null,
  effectiveProvider: meta.effectiveProvider ?? null,
  effectiveModel: meta.effectiveModel ?? null,
  hasGateResults: Array.isArray(meta.gateResults),
}));
const ledger = await (await fetch(`http://localhost:4000/api/run-ledger/${taskId}`)).json();
const r = ledger.run || {};
console.log('LEDGER_MODEL ' + JSON.stringify({
  assignedProvider: r.assignedProvider ?? null,
  assignedModel: r.assignedModel ?? null,
  effectiveProvider: r.effectiveProvider ?? null,
  effectiveModel: r.effectiveModel ?? null,
}));
if (t.worker === 'hermes' && t.linkedRunId) {
  const runs = await (await fetch('http://localhost:4000/api/hermes-api/runs')).json();
  const hr = (Array.isArray(runs) ? runs : []).find((x) => x.id === t.linkedRunId);
  console.log('HERMES_RUN_RECORD ' + JSON.stringify({ id: hr?.id, provider: hr?.provider ?? null, model: hr?.model ?? null, status: hr?.status }));
}
