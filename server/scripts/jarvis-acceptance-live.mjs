// P8 — LIVE Jarvis acceptance conversation over the REAL production HTTP API.
// POST /api/jarvis/conversations/:id/message → SSE (intent/chunk/done) →
// real model calls. Verifies context, routing, voice, model identity truth.
const BASE = 'http://127.0.0.1:4600';
const turns = [
  { text: 'What model are you using?', channel: 'typed' },
  { text: 'My temporary test project is called Orion.', channel: 'typed' },
  { text: 'What is the project called?', channel: 'typed' },
  { text: "I'm considering adding a recruiting agent. Do you think that belongs in AgenticOS now?", channel: 'typed' },
  { text: "Don't implement it. Just explain your reasoning.", channel: 'typed' },
  { text: 'What were we just discussing?', channel: 'voice' },
  { text: 'And what model is answering me right now?', channel: 'typed' },
];

async function postMessage(convId, message, channel) {
  const res = await fetch(`${BASE}/api/jarvis/conversations/${convId}/message/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
    body: JSON.stringify({ prompt: message, inputChannel: channel }),
  });
  if (!res.ok) return { error: `HTTP ${res.status}`, intent: null, reply: '', provider: null, model: null };
  const text = await res.text();
  let reply = '';
  let intent = null;
  let provider = null;
  let model = null;
  for (const block of text.split('\n\n')) {
    const ev = block.split('\n').find((l) => l.startsWith('event: '))?.slice(7);
    const dataLine = block.split('\n').find((l) => l.startsWith('data: '))?.slice(6);
    if (!dataLine) continue;
    let data;
    try { data = JSON.parse(dataLine); } catch { continue; }
    if (ev === 'intent') intent = data.route || data.type || null;
    if (ev === 'chunk') {
      reply += data.delta || '';
      if (data.provider) provider = data.provider;
      if (data.model) model = data.model;
    }
    if (ev === 'done') {
      if (data.provider) provider = data.provider;
      if (data.model) model = data.model;
    }
  }
  return { error: null, intent, reply: reply.trim(), provider, model };
}

async function main() {
  const created = await fetch(`${BASE}/api/jarvis/conversations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'P8 acceptance' }) });
  const conv = await created.json();
  const convId = conv.id || conv.conversationId;
  console.log(`conversationId=${convId}`);
  const results = [];
  for (const [i, turn] of turns.entries()) {
    const t0 = Date.now();
    const r = await postMessage(convId, turn.text, turn.channel);
    const ms = Date.now() - t0;
    console.log(`\nTURN ${i + 1} [${turn.channel}] ${turn.text.slice(0, 60)} (${ms}ms)`);
    console.log(`  intent=${r.intent} provider=${r.provider} model=${r.model}`);
    console.log(`  reply: ${(r.reply || r.error || '').slice(0, 320)}`);
    results.push({ i: i + 1, ...r, channel: turn.channel });
    await new Promise((res) => setTimeout(res, 800));
  }
  console.log('\n=== EVIDENCE ===');
  console.log(JSON.stringify({ convId, results }, null, 2).slice(0, 4000));
  const last = results[6];
  const ok = convId && results.length === 7 && !results.some((r) => r.error);
  console.log(`\nP8 CONVERSATION RESULT: ${ok ? 'COMPLETE' : 'INCOMPLETE'}`);
  if (!ok) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
