// P21 capture: model truth, artifacts, parent/child, distilled memory.
const taskId = 'bgtask-c4966c326';
const t = await (await fetch(`http://localhost:4000/api/background-tasks/${taskId}`)).json();
console.log('MODEL_TRUTH ' + JSON.stringify({
  assignedProvider: t.metadata?.assignedProvider ?? t.metadata?.agentProvider ?? null,
  assignedModel: t.metadata?.assignedModel ?? t.metadata?.agentModel ?? null,
  effectiveProvider: t.metadata?.effectiveProvider ?? t.metadata?.resolvedProvider ?? null,
  effectiveModel: t.metadata?.effectiveModel ?? t.metadata?.resolvedModel ?? null,
  operationId: t.metadata?.operationId ?? null,
  goalId: t.linkedRunId,
  attempt: t.attempt,
}));
console.log('ARTIFACTS ' + JSON.stringify(t.filesChanged));
const ledger = await (await fetch(`http://localhost:4000/api/run-ledger/${taskId}`)).json();
console.log('LEDGER_PARENT ' + JSON.stringify({ parent: ledger.parent ? ledger.parent.taskId : null, children: (ledger.children || []).map((c) => c.taskId) }));
const mem = await (await fetch('http://localhost:4000/api/memory/search?q=verification&scope=project:proj-ac4c89f0')).json();
console.log('DISTILLED ' + JSON.stringify((Array.isArray(mem) ? mem : []).slice(0, 3).map((x) => ({ id: x.memory?.id, title: x.memory?.title, content: (x.memory?.content || '').slice(0, 140) })), null, 1));
