// Dump the failed hermes run record (errorMessage only — safe fields).
const runs = await (await fetch('http://localhost:4000/api/hermes-api/runs')).json();
const r = (Array.isArray(runs) ? runs : []).find((x) => x.id === 'hapi-msqltx97-1');
if (!r) { console.log('RUN_NOT_FOUND'); process.exit(0); }
console.log(JSON.stringify({
  id: r.id,
  hermesRunId: r.hermesRunId,
  status: r.status,
  provider: r.provider,
  model: r.model,
  errorMessage: String(r.errorMessage || '').slice(0, 500),
  finalText: String(r.finalText || '').slice(0, 200),
  eventCount: (r.events || []).length,
  lastEvents: (r.events || []).slice(-5).map((e) => `${e.type || e.kind}:${String(e.message || e.summary || '').slice(0, 120)}`),
}, null, 1));
