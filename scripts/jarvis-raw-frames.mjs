// Dump ALL raw SSE data frames from one Jarvis request (no parsing), so we
// can see the true event shapes + the answer.
const BASE = 'http://127.0.0.1:4000';
const CONV = 'conv-e41484b4-';
const operationId = `jarvis-raw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const res = await fetch(`${BASE}/api/jarvis/conversations/${CONV}/message/stream`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ prompt: 'What model are you using?', operationId, inputChannel: 'typed' }),
  signal: AbortSignal.timeout(120000),
});
console.log('HTTP', res.status);
const reader = res.body.getReader();
const decoder = new TextDecoder();
let buf = '';
let n = 0;
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
    n += 1;
    if (n <= 12) console.log('FRAME' + n + ':', d.slice(0, 500));
  }
}
console.log('TOTAL_FRAMES:', n);
