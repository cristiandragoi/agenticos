// P16/P17: measure real Jarvis request latency through the RUNNING app.
// Three short prompts. Captures: HTTP headers → first_token marker → done.
const BASE = 'http://127.0.0.1:4000';
const CONV = 'conv-e41484b4-';

const prompts = [
  'What model are you using?',
  'Which provider is serving it?',
  'What was my previous question?',
];

for (const prompt of prompts) {
  const operationId = `jarvis-lat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tFetch = Date.now();
  const res = await fetch(`${BASE}/api/jarvis/conversations/${CONV}/message/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, operationId, inputChannel: 'typed' }),
    signal: AbortSignal.timeout(120000),
  });
  const tHeaders = Date.now();
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let firstTokenAt = 0;
  let doneAt = 0;
  let answer = '';
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
        if (ev.marker === 'first_token' && !firstTokenAt) firstTokenAt = Date.now();
        if (ev.delta) { if (!firstTokenAt) firstTokenAt = Date.now(); answer += ev.delta; }
        if (ev.type === 'done' || ev.event === 'done') doneAt = Date.now();
      } catch { /* skip */ }
    }
  }
  const tEnd = Date.now();
  console.log('PROMPT:', JSON.stringify(prompt));
  console.log(`  HTTP ${res.status} headers=${tHeaders - tFetch}ms first_token=${firstTokenAt ? firstTokenAt - tFetch : 'N/A'}ms done=${doneAt ? doneAt - tFetch : 'N/A'}ms total=${tEnd - tFetch}ms`);
  console.log(`  ANSWER(${answer.length}): ${JSON.stringify(answer.slice(0, 220))}`);
}
