// Capture the FULL answer text (delta frames) for "What model are you using?"
const BASE = 'http://127.0.0.1:4000';
const CONV = 'conv-e41484b4-';
const operationId = `jarvis-answer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const res = await fetch(`${BASE}/api/jarvis/conversations/${CONV}/message/stream`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ prompt: 'What model are you using?', operationId, inputChannel: 'typed' }),
  signal: AbortSignal.timeout(120000),
});
const reader = res.body.getReader();
const decoder = new TextDecoder();
let buf = '';
let text = '';
let firstToken = 0;
let firstTokenSeen = false;
const t0 = Date.now();
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
      if (ev.marker === 'first_token') { firstToken = ev.elapsedMs; firstTokenSeen = true; }
      if (typeof ev.delta === 'string') text += ev.delta;
    } catch { /* skip */ }
  }
}
const total = Date.now() - t0;
console.log('FIRST_TOKEN_ELAPSED_MS:', firstTokenSeen ? firstToken : 'N/A');
console.log('TOTAL_MS:', total);
console.log('FULL_ANSWER:', JSON.stringify(text));
