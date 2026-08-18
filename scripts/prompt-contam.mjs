// Contamination repro: 12 prior turns (reliability-test style churn), then the
// exact prompt-integrity test. Proves history + "Do not repeat yourself" flips
// the model into refusal/runtime-inspection mode.
import { createWriteStream } from 'node:fs';

const BASE = 'http://127.0.0.1:4000/api/jarvis';
const out = createWriteStream('C:/Users/Cris/AppData/Local/Temp/prompt-contam.jsonl', { flags: 'a' });
const log = (o) => { out.write(JSON.stringify(o) + '\n'); console.log(JSON.stringify(o)); };

async function createConversation() {
  const res = await fetch(`${BASE}/conversations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: `contam-${Date.now()}` }) });
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
  const operationId = `cont-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const record = { label, prompt, operationId };
  try {
    const res = await fetch(`${BASE}/conversations/${convId}/message/stream`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, operationId }) });
    if (!res.ok || !res.body) { record.result = 'HTTP_FAIL'; log(record); return record; }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '', finalText = '', sawDone = false, errorChunk = null;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const frameText = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        for (const { event, data } of parseFrames(frameText)) {
          if (event === 'chunk') finalText += data?.delta || '';
          else if (event === 'error') errorChunk = data?.error || data?.reason || 'error';
          else if (event === 'done') sawDone = true;
        }
      }
    }
    record.renderedResponse = finalText;
    record.sawDone = sawDone;
    record.errorChunk = errorChunk;
    record.result = sawDone && finalText.length > 0 && !errorChunk ? 'PASS' : 'FAIL';
    log(record);
  } catch (err) { record.result = 'EXCEPTION'; record.error = String(err?.message || err); log(record); }
  return record;
}

try {
  const convId = await createConversation();
  log({ event: 'CONV_CREATED', convId });
  // 12 prior churn turns like the reliability test
  for (let i = 1; i <= 6; i++) {
    await runTurn(convId, 'Jarvis, are you there?', `churn-a${i}`);
    await new Promise(r => setTimeout(r, 800));
    await runTurn(convId, 'What model are you using?', `churn-b${i}`);
    await new Promise(r => setTimeout(r, 800));
  }
  await new Promise(r => setTimeout(r, 1500));
  // Now the exact test prompt in the SAME contaminated conversation
  const test = await runTurn(convId, 'Repeat exactly this sentence and nothing else: THE SKY IS GREEN', 'test-exact');
  out.end();
  const exact = /^THE SKY IS GREEN$/.test((test.renderedResponse || '').trim());
  console.log(JSON.stringify({ event: 'SUMMARY', convId, exact, rendered: test.renderedResponse }));
  process.exit(0);
} catch (err) { log({ event: 'FATAL', error: String(err?.message || err) }); out.end(); process.exit(1); }
