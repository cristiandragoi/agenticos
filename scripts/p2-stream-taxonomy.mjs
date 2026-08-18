// Capture the streaming event taxonomy + deltas for a LongCat-assigned turn.
const BASE = 'http://localhost:4000';
const stamp = Date.now().toString(36).slice(-5);
const j = async (p, o) => { const r = await fetch(BASE + p, o); let b = null; try { b = await r.json(); } catch {} return { status: r.status, body: b }; };

const conv = await j('/api/jarvis/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: `Stream taxonomy ${stamp}` }) });
const convId = conv.body?.id || conv.body?.conversation?.id || conv.body?.conversationId;
const sse = await fetch(BASE + `/api/jarvis/conversations/${convId}/message/stream`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ prompt: 'Reply with exactly: STREAM_DELTAS_OK', operationId: 'lc-sd-' + stamp }),
});
const text = await sse.text();
const events = [];
let ev = null;
for (const raw of text.split('\n')) {
  const line = raw.trim();
  if (line.startsWith('event:')) { ev = line.slice(6).trim(); continue; }
  if (line.startsWith('data:')) {
    const p = line.slice(5).trim();
    let obj = null; try { obj = JSON.parse(p); } catch {}
    events.push({ event: ev, type: obj?.type || null, content: obj?.content || obj?.delta || null, provider: obj?.provider || null, model: obj?.model || null });
  }
}
const deltaEvents = events.filter((e) => /delta|token|chunk/i.test(String(e.event)));
const deltas = deltaEvents.map((e) => {
  if (typeof e.content === 'string') return e.content;
  return '';
}).filter((c) => c != null).join('');
console.log('RESULT ' + JSON.stringify({
  eventNames: [...new Set(events.map((e) => e.event))],
  totalEvents: events.length,
  deltaEventCount: deltaEvents.length,
  rawChunkSamples: deltaEvents.slice(0, 3),
  deltasJoined: deltas.slice(0, 80),
  replyContainsToken: deltas.includes('STREAM_DELTAS_OK'),
  done: events.find((e) => e.event === 'done') || null,
}, null, 1));
