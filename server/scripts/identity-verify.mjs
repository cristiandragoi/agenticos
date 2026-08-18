// P3 verification — fresh conversation, two identity turns with the
// strengthened FACT directive. Expect provider=ollama / model=qwen3.5:4b.
const BASE = 'http://127.0.0.1:4600';
const turns = [
  { text: 'What model are you using?', channel: 'typed' },
  { text: 'And what model is answering me right now?', channel: 'typed' },
];

async function postMessage(convId, message, channel) {
  const res = await fetch(`${BASE}/api/jarvis/conversations/${convId}/message/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
    body: JSON.stringify({ prompt: message, inputChannel: channel }),
  });
  if (!res.ok) return { error: `HTTP ${res.status}` };
  const text = await res.text();
  let reply = '', provider = null, model = null;
  for (const block of text.split('\n\n')) {
    const ev = block.split('\n').find((l) => l.startsWith('event: '))?.slice(7);
    const dataLine = block.split('\n').find((l) => l.startsWith('data: '))?.slice(6);
    if (!dataLine) continue;
    let data;
    try { data = JSON.parse(dataLine); } catch { continue; }
    if (ev === 'chunk') { reply += data.delta || ''; if (data.provider) provider = data.provider; if (data.model) model = data.model; }
    if (ev === 'done') { if (data.provider) provider = data.provider; if (data.model) model = data.model; }
  }
  return { error: null, reply: reply.trim(), provider, model };
}

const created = await fetch(`${BASE}/api/jarvis/conversations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'P3 identity verify' }) });
const conv = await created.json();
const convId = conv.id || conv.conversationId;
for (const [i, turn] of turns.entries()) {
  const r = await postMessage(convId, turn.text, turn.channel);
  console.log(`\nTURN ${i + 1}: ${turn.text}`);
  console.log(`  runtime(chunk): provider=${r.provider} model=${r.model}`);
  console.log(`  reply: ${(r.reply || r.error || '').slice(0, 300)}`);
  const truth = r.provider && r.model && r.reply && (r.reply.includes(r.model)) && (r.reply.toLowerCase().includes('ollama'));
  console.log(`  IDENTITY MATCHES RUNTIME: ${truth ? 'YES' : 'NO'}`);
  await new Promise((res) => setTimeout(res, 500));
}
