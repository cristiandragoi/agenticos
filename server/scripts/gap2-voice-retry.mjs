// Retry the voice turn on the existing GAP2 conversation with the exact
// Deepgram transcript (same conversation, voice channel).
const BASE = 'http://127.0.0.1:4600';
const convId = 'conv-adc086b7-';
const res = await fetch(`${BASE}/api/jarvis/conversations/${convId}/message/stream`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
  body: JSON.stringify({ prompt: 'What was my voice test word?', inputChannel: 'voice' }),
});
const text = await res.text();
let reply = '', provider = null, model = null, intent = null;
for (const block of text.split('\n\n')) {
  const ev = block.split('\n').find((l) => l.startsWith('event: '))?.slice(7);
  const dataLine = block.split('\n').find((l) => l.startsWith('data: '))?.slice(6);
  if (!dataLine) continue;
  let data; try { data = JSON.parse(dataLine); } catch { continue; }
  if (ev === 'intent') intent = data.route || data.type || null;
  if (ev === 'chunk') { reply += data.delta || ''; if (data.provider) provider = data.provider; if (data.model) model = data.model; }
  if (ev === 'done') { if (data.provider) provider = data.provider; if (data.model) model = data.model; }
}
console.log(`VOICE TURN retry: intent=${intent} provider=${provider} model=${model}`);
console.log(`  reply="${reply.trim().slice(0, 250)}"`);
console.log(`RECALLS NEBULA: ${/NEBULA/i.test(reply) ? 'YES' : 'NO (model-dependent)'}`);
