// Reproduce the prompt-integrity failure: same conversation, first the user's
// original "repeat after me: the sky is green!" then the exact test prompt.
import { createWriteStream } from 'node:fs';

const BASE = 'http://127.0.0.1:4000/api/jarvis';
const out = createWriteStream('C:/Users/Cris/AppData/Local/Temp/prompt-repro.jsonl', { flags: 'a' });
const log = (o) => { out.write(JSON.stringify(o) + '\n'); console.log(JSON.stringify(o)); };

async function createConversation() {
  const res = await fetch(`${BASE}/conversations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: `prompt-repro-${Date.now()}` }) });
  const data = await res.json();
  return data.conversation?.id || data.id || data.conversationId;
}

function parseFrames(text) {
  const frames = [];
  for (const rawFrame of text.split('\n\n')) {
    if (!rawFrame.trim()) continue;
    let event = 'message', data = null;
    for (const line of rawFrame.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data = line.slice(5).trim();
    }
    if (data) { try { frames.push({ event, data: JSON.parse(data) }); } catch {} }
  }
  return frames;
}

async function runTurn(convId, prompt, label) {
  const started = Date.now();
  const operationId = `repro-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const record = { label, prompt, operationId };
  try {
    const res = await fetch(`${BASE}/conversations/${convId}/message/stream`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, operationId }) });
    record.httpStatus = res.status;
    if (!res.ok || !res.body) { record.result = 'HTTP_FAIL'; log(record); return record; }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '', finalText = '', firstTokenMs = null, sawDone = false, errorChunk = null, provider = null, model = null;
    const events = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const frameText = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        for (const { event, data } of parseFrames(frameText)) {
          events.push({ event, data });
          if (event === 'timing' && data?.marker === 'first_token' && firstTokenMs === null) firstTokenMs = Date.now() - started;
          else if (event === 'chunk') { finalText += data?.delta || ''; provider = data?.provider || provider; model = data?.model || model; }
          else if (event === 'error') errorChunk = data?.error || data?.reason || 'error';
          else if (event === 'done') { sawDone = true; provider = data?.provider || provider; model = data?.model || model; }
        }
      }
    }
    record.firstTokenMs = firstTokenMs; record.sawDone = sawDone; record.errorChunk = errorChunk;
    record.provider = provider; record.model = model; record.renderedResponse = finalText;
    record.result = sawDone && finalText.length > 0 && !errorChunk ? 'PASS' : (errorChunk ? 'ERROR' : 'NO_DONE');
    log(record);
  } catch (err) { record.result = 'EXCEPTION'; record.error = String(err?.message || err); log(record); }
  return record;
}

try {
  const convId = await createConversation();
  log({ event: 'CONV_CREATED', convId });
  // 1. User's ORIGINAL failing turn
  const r1 = await runTurn(convId, 'repeat after me: the sky is green!', 'A-original');
  await new Promise(r => setTimeout(r, 1500));
  // 2. Exact test prompt in SAME conversation
  const r2 = await runTurn(convId, 'Repeat exactly this sentence and nothing else: THE SKY IS GREEN', 'B-exact');
  await new Promise(r => setTimeout(r, 1500));
  // 3. Second exact test (proves repeated identical prompts work)
  const r3 = await runTurn(convId, 'Repeat exactly this sentence and nothing else: THE SKY IS GREEN', 'C-exact-repeat');
  out.end();
  console.log(JSON.stringify({ event: 'SUMMARY', convId, r1: r1.renderedResponse, r2: r2.renderedResponse, r3: r3.renderedResponse, r2exact: /^THE SKY IS GREEN$/.test((r2.renderedResponse||'').trim()) }));
  process.exit(0);
} catch (err) { log({ event: 'FATAL', error: String(err?.message || err) }); out.end(); process.exit(1); }
