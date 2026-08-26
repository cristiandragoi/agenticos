// fire-post-restart-reconstruction.mjs — after backend restart, ask "where were we?"
// and verify state is reconstructed from persistence (not in-memory).
const CONV = 'conv-fcf6c9a8-';
const BASE = 'http://127.0.0.1:4000';

const q = 'where were we?';
const body = JSON.stringify({ prompt: q, operationId: `op-postrestart-${Date.now()}` });
const res = await fetch(`${BASE}/api/jarvis/conversations/${CONV}/message`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
});
const text = await res.text();
let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
console.log('HTTP', res.status, 'route=', parsed?.route, 'status=', parsed?.status, 'error=', parsed?.error || '(none)');

const mres = await fetch(`${BASE}/api/jarvis/conversations/${CONV}/messages`);
const msgs = await mres.json();
const arr = Array.isArray(msgs) ? msgs : [];
console.log('\n=== LAST AGENT MESSAGES (post-restart) ===');
for (const m of arr.slice(-3)) {
  if (m.role === 'agent') console.log('\n[agent]', String(m.content || '').slice(0, 500));
}
