// Verify the RUNNING backend serves the NEW system_status capability answer.
const BASE = 'http://127.0.0.1:4000';
const CONV = 'conv-e41484b4-';
const operationId = `jarvis-cap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const res = await fetch(`${BASE}/api/jarvis/conversations/${CONV}/message/stream`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ prompt: 'What can you do right now?', operationId, inputChannel: 'typed' }),
  signal: AbortSignal.timeout(60000),
});
const reader = res.body.getReader();
const decoder = new TextDecoder();
let buf = '';
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
    try { const ev = JSON.parse(d); if (typeof ev.delta === 'string') answer += ev.delta; } catch { /* skip */ }
  }
}
console.log('ANSWER:', JSON.stringify(answer.slice(0, 600)));
console.log('HAS_NEW_CAPABILITY_ANSWER:', answer.includes('operational commander of Agentic OS'));
console.log('HAS_OLD_MOCK_ANSWER:', answer.includes('CodeX available') || answer.includes('Healthy runtimes'));
