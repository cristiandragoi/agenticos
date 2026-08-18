// Verify the delegation-end fix: send a codex-routing prompt (approval
// required so no real execution) and check /api/execution/current after —
// the parent stream record must NOT be left at ROUTING.
const BASE = 'http://127.0.0.1:4000';
const CONV = 'conv-e110afce-';
const operationId = `jarvis-fixcheck-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const prompt = 'Few it will be good if you can help me today to to, fix the codex.';

const res = await fetch(`${BASE}/api/jarvis/conversations/${CONV}/message/stream`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ prompt, operationId, inputChannel: 'typed', approvalPolicy: 'require' }),
  signal: AbortSignal.timeout(45000),
});
const reader = res.body.getReader();
const decoder = new TextDecoder();
let buf = '';
const events = [];
while (true) {
  const { value, done } = await reader.read();
  if (done) break;
  buf += decoder.decode(value, { stream: true });
  const parts = buf.split('\n\n');
  buf = parts.pop() || '';
  for (const p of parts) {
    const dl = p.split('\n').find((l) => l.startsWith('data:'));
    if (!dl) continue;
    const raw = dl.slice(5).trim();
    if (!raw || raw === '[DONE]') continue;
    let ev;
    try { ev = JSON.parse(raw); } catch { continue; }
    events.push({ type: ev.type || ev.event, route: ev.route, status: ev.status, goalId: ev.goalId, state: ev.state });
  }
}
console.log('OP:', operationId);
console.log('EVENTS:', JSON.stringify(events.slice(0, 12)));

// Check execution state after
const cur = await fetch(`${BASE}/api/execution/current`).then((r) => r.json());
const c = cur.current;
console.log('CURRENT_AFTER:', c ? `${c.operationId} | ${c.status} | note ${c.note} | ended ${c.endedAt ? 'yes' : 'null'}` : 'null');
const mine = (cur.history || []).find((h) => h.operationId === operationId);
console.log('PARENT_IN_HISTORY:', mine ? `${mine.status} | ended ${mine.endedAt ? 'yes' : 'null'} | note ${mine.note}` : 'NOT FOUND');
