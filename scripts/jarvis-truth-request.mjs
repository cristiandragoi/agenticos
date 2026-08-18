// One REAL Jarvis request — dump event payloads (esp. gateway.selected) +
// timing. Same endpoint the renderer uses.
const BASE = 'http://127.0.0.1:4000';
const CONV = process.argv[2] || 'conv-e41484b4-';
const PROMPT = process.argv[3] || 'What model are you using?';
const operationId = `jarvis-truth2-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const tFetchStart = Date.now();
const res = await fetch(`${BASE}/api/jarvis/conversations/${CONV}/message/stream`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ prompt: PROMPT, operationId, inputChannel: 'typed' }),
  signal: AbortSignal.timeout(120000),
});
const tHeaders = Date.now();
console.log(`HTTP=${res.status} headers_after=${tHeaders - tFetchStart}ms`);
if (!res.ok) { console.log((await res.text()).slice(0, 400)); process.exit(1); }

const reader = res.body.getReader();
const decoder = new TextDecoder();
let buffer = '';
let firstTokenAt = 0;
let answer = '';
const eventSummary = [];
while (true) {
  const { value, done } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  const frames = buffer.split('\n\n');
  buffer = frames.pop() || '';
  for (const frame of frames) {
    const line = frame.split('\n').find((l) => l.startsWith('data:'));
    if (!line) continue;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') continue;
    try {
      const ev = JSON.parse(data);
      const type = ev.type || ev.event || '(none)';
      if (type === 'gateway.selected') {
        console.log('GATEWAY_SELECTED:', JSON.stringify(ev).slice(0, 800));
      }
      if (type === 'gateway.completed') {
        console.log('GATEWAY_COMPLETED:', JSON.stringify(ev).slice(0, 800));
      }
      if (type === 'conversation' && ev.data) {
        const d = ev.data;
        const text = typeof d.content === 'string' ? d.content : (typeof d.text === 'string' ? d.text : '');
        if (text) {
          if (!firstTokenAt) firstTokenAt = Date.now();
          answer += text;
        }
        if (d.provider || d.model) console.log('CONV_MSG_META:', JSON.stringify({ provider: d.provider, model: d.model, route: d.route }));
      }
      if (ev.content && typeof ev.content === 'string') {
        if (!firstTokenAt) firstTokenAt = Date.now();
        answer += ev.content;
      }
      eventSummary.push(type);
    } catch { /* non-JSON */ }
  }
}
const tEnd = Date.now();
console.log(`first_token_after_headers=${firstTokenAt ? firstTokenAt - tHeaders : 'N/A'}ms`);
console.log(`total=${tEnd - tFetchStart}ms`);
console.log('EVENTS:', JSON.stringify(eventSummary));
console.log('ANSWER_LEN:', answer.length);
console.log('ANSWER:', answer.slice(0, 1500));
