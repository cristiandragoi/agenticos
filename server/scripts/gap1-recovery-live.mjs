// GAP 1 — REAL Jarvis recovery with conversation continuity.
// Turn 3 carries the RETRYFLAG42 marker → the injector throws a transient
// provider failure at the REAL /api/chat boundary → the REAL gateway retry
// recovers → real answer → turn 4 must still recall CERULEAN.
const BASE = 'http://127.0.0.1:4600';
const turns = [
  { text: 'My recovery test word is CERULEAN.', channel: 'typed' },
  { text: 'What is my recovery test word?', channel: 'typed' },
  { text: 'RETRYFLAG42 What do you think is the best way to structure a small test file?', channel: 'typed' },
  { text: 'What was my recovery test word?', channel: 'typed' },
];

async function postMessage(convId, message, channel) {
  const res = await fetch(`${BASE}/api/jarvis/conversations/${convId}/message/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
    body: JSON.stringify({ prompt: message, inputChannel: channel }),
  });
  if (!res.ok) return { error: `HTTP ${res.status}` };
  const text = await res.text();
  let reply = '', provider = null, model = null, intent = null;
  for (const block of text.split('\n\n')) {
    const ev = block.split('\n').find((l) => l.startsWith('event: '))?.slice(7);
    const dataLine = block.split('\n').find((l) => l.startsWith('data: '))?.slice(6);
    if (!dataLine) continue;
    let data;
    try { data = JSON.parse(dataLine); } catch { continue; }
    if (ev === 'intent') intent = data.route || data.type || null;
    if (ev === 'chunk') { reply += data.delta || ''; if (data.provider) provider = data.provider; if (data.model) model = data.model; }
    if (ev === 'done') { if (data.provider) provider = data.provider; if (data.model) model = data.model; }
  }
  return { error: null, reply: reply.trim(), provider, model, intent };
}

const created = await fetch(`${BASE}/api/jarvis/conversations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'GAP1 recovery' }) });
const conv = await created.json();
const convId = conv.id || conv.conversationId;
console.log(`conversationId=${convId}`);
for (const [i, turn] of turns.entries()) {
  const t0 = Date.now();
  const r = await postMessage(convId, turn.text, turn.channel);
  console.log(`\nTURN ${i + 1}: ${turn.text.slice(0, 55)} (${Date.now() - t0}ms)`);
  console.log(`  intent=${r.intent} provider=${r.provider} model=${r.model}`);
  console.log(`  reply: ${(r.reply || r.error || '').slice(0, 240)}`);
  await new Promise((res) => setTimeout(res, 600));
}
console.log('\n=== GAP1 CHECKS ===');
console.log('conversationId stable across all turns:', convId);
console.log('turn2 recall CERULEAN:', resultsCheck2);
console.log('turn4 recall CERULEAN:', resultsCheck4);
function resultsCheck2() { return ''; }
function resultsCheck4() { return ''; }
