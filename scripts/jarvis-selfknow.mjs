// Capture the RAW SSE answer for "What model are you using?" — proves what
// Jarvis actually says about its own model (self-knowledge behavior).
const BASE = 'http://127.0.0.1:4000';
const CONV = 'conv-e41484b4-';
const operationId = `jarvis-selfknow-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const res = await fetch(`${BASE}/api/jarvis/conversations/${CONV}/message/stream`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ prompt: 'What model are you using?', operationId, inputChannel: 'typed' }),
  signal: AbortSignal.timeout(120000),
});
console.log('HTTP', res.status);
if (!res.ok) process.exit(1);
const reader = res.body.getReader();
const decoder = new TextDecoder();
let buf = '';
let text = '';
while (true) {
  const { value, done } = await reader.read();
  if (done) break;
  buf += decoder.decode(value, { stream: true });
  const frames = buf.split('\n\n');
  buf = frames.pop() || '';
  for (const f of frames) {
    const dl = f.split('\n').find((l) => l.startsWith('data:'));
    if (!dl) continue;
    const d = dl.slice(5).trim();
    if (!d || d === '[DONE]') continue;
    try {
      const ev = JSON.parse(d);
      const c = ev.content ?? ev.data?.content ?? ev.data?.text ?? '';
      if (typeof c === 'string' && c) text += c;
    } catch { /* skip */ }
  }
}
console.log('RAW_ANSWER:', JSON.stringify(text.slice(0, 2000)));
