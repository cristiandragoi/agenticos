// GAP 2 — strongest programmatic audio evidence: real TTS synthesis → real
// Deepgram transcription round-trip → Jarvis voice turn on the SAME
// conversation → TTS of the answer. Physical mic/speaker = human check.
import fs from 'fs';
const BASE = 'http://127.0.0.1:4600';

// 1) Establish context via typed turn
async function postMessage(convId, message, channel) {
  const res = await fetch(`${BASE}/api/jarvis/conversations/${convId}/message/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
    body: JSON.stringify({ prompt: message, inputChannel: channel }),
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
  return { reply: reply.trim(), provider, model, intent };
}

async function tts(text) {
  const res = await fetch(`${BASE}/api/voice/speak`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, agentId: 'agent-jarvis' }) });
  const buf = Buffer.from(await res.arrayBuffer());
  const ct = res.headers.get('content-type') || '';
  return { ok: res.ok, bytes: buf.length, ct, buf };
}

async function transcribe(buf, mimetype) {
  const form = new FormData();
  form.append('audio', new Blob([buf], { type: mimetype }), 'utterance');
  const res = await fetch(`${BASE}/api/voice/transcribe`, { method: 'POST', body: form });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, text: json.text || json.error || '' };
}

// A) TTS the spoken question → real audio
const spoken = 'What was my voice test word?';
const t1 = await tts(spoken);
console.log(`TTS "${spoken}" → ok=${t1.ok} bytes=${t1.bytes} content-type=${t1.ct}`);
const wavLike = t1.bytes > 500 && (t1.ct.includes('wav') || t1.ct.includes('audio') || t1.bytes > 2000);
console.log(`TTS AUDIO VALID: ${wavLike ? 'YES' : 'NO'}`);
fs.writeFileSync('scripts/gap2-tts-audio.bin', t1.buf);

// B) Real transcription of that audio (Deepgram)
const tr = await transcribe(t1.buf, t1.ct);
console.log(`TRANSCRIBE → ok=${tr.ok} text="${tr.text}"`);
const transcript = tr.text;

// C) Jarvis conversation: establish NEBULA, then voice turn with the transcript
const created = await fetch(`${BASE}/api/jarvis/conversations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'GAP2 voice' }) });
const conv = await created.json();
const convId = conv.id || conv.conversationId;
console.log(`conversationId=${convId}`);
const c1 = await postMessage(convId, 'My voice test word is NEBULA.', 'typed');
console.log(`TURN typed: reply="${c1.reply.slice(0, 120)}"`);

if (transcript && transcript.trim()) {
  const c2 = await postMessage(convId, transcript, 'voice');
  console.log(`TURN voice (transcript): intent=${c2.intent} provider=${c2.provider} model=${c2.model}`);
  console.log(`  reply="${c2.reply.slice(0, 200)}"`);
  const recalled = /NEBULA/i.test(c2.reply);
  console.log(`VOICE TURN RECALLS NEBULA FROM CONTEXT: ${recalled ? 'YES' : 'NO (model-dependent)'}`);
  // D) TTS the Jarvis answer
  if (c2.reply) {
    const t2 = await tts(c2.reply.slice(0, 200));
    console.log(`TTS answer → ok=${t2.ok} bytes=${t2.bytes} content-type=${t2.ct}`);
    fs.writeFileSync('scripts/gap2-answer-audio.bin', t2.buf);
  }
} else {
  console.log('TRANSCRIPTION FAILED — cannot continue voice turn');
}
