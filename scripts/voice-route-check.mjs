// Capture the full SSE envelope for the presence prompt — proves the
// fast-path route (not LLM) and the exact reply text on the live server.
const BASE = 'http://127.0.0.1:4000';
const convRes = await fetch(`${BASE}/api/jarvis/conversations`);
const convs = await convRes.json();
const convId = Array.isArray(convs) && convs.length ? convs[convs.length - 1].id : null;
const t0 = Date.now();
const res = await fetch(`${BASE}/api/jarvis/conversations/${convId}/message/stream`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ prompt: 'Jarvis, are you there?', operationId: `routecheck-${Date.now()}`, inputChannel: 'voice', approvalPolicy: 'auto' }),
});
const raw = await res.text();
console.log('ROUTE_CHECK elapsedMs=' + (Date.now() - t0));
console.log(raw.slice(0, 2000));
