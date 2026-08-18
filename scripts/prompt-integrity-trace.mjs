// One-turn prompt integrity forensic trace.
// Sends the exact test prompt through the REAL packaged backend and captures
// every stage: request body, SSE events, final rendered text.
import { createWriteStream } from 'node:fs';

const BASE = 'http://127.0.0.1:4000/api/jarvis';
const out = createWriteStream('C:/Users/Cris/AppData/Local/Temp/prompt-trace.jsonl', { flags: 'a' });
const log = (o) => { out.write(JSON.stringify(o) + '\n'); console.log(JSON.stringify(o)); };

async function createConversation() {
  const res = await fetch(`${BASE}/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: `prompt-integrity-${Date.now()}` })
  });
  const data = await res.json();
  return data.conversation?.id || data.id || data.conversationId;
}

function parseFrames(text) {
  const frames = [];
  for (const rawFrame of text.split('\n\n')) {
    if (!rawFrame.trim()) continue;
    let event = 'message';
    let data = null;
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
  const operationId = `pi-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const record = { label, prompt, operationId };
  try {
    const res = await fetch(`${BASE}/conversations/${convId}/message/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, operationId })
    });
    record.httpStatus = res.status;
    if (!res.ok || !res.body) { record.result = 'HTTP_FAIL'; log(record); return record; }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let firstTokenMs = null;
    let finalText = '';
    let sawDone = false;
    let errorChunk = null;
    let provider = null, model = null;
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
          const now = Date.now() - started;
          if (event === 'timing' && data?.marker === 'first_token' && firstTokenMs === null) firstTokenMs = now;
          else if (event === 'chunk') { finalText += data?.delta || ''; provider = data?.provider || provider; model = data?.model || model; }
          else if (event === 'error') { errorChunk = data?.error || data?.reason || 'error'; }
          else if (event === 'done') { sawDone = true; provider = data?.provider || provider; model = data?.model || model; }
        }
      }
    }
    record.firstTokenMs = firstTokenMs;
    record.sawDone = sawDone;
    record.errorChunk = errorChunk;
    record.provider = provider;
    record.model = model;
    record.responseLength = finalText.length;
    record.renderedResponse = finalText;
    record.eventTypes = [...new Set(events.map(e => e.event))];
    record.result = sawDone && finalText.length > 0 && !errorChunk ? 'PASS' : (errorChunk ? 'ERROR' : 'NO_DONE');
    log(record);
  } catch (err) {
    record.result = 'EXCEPTION';
    record.error = String(err?.message || err);
    log(record);
  }
  return record;
}

const prompts = [
  { label: 'TEST1', prompt: 'Repeat exactly this sentence and nothing else: THE SKY IS GREEN' },
  { label: 'TEST2', prompt: 'Reply with exactly: JARVIS TEST OK' },
];

try {
  const convId = await createConversation();
  log({ event: 'CONV_CREATED', convId });
  const results = [];
  for (const p of prompts) {
    await new Promise(r => setTimeout(r, 1500));
    results.push(await runTurn(convId, p.prompt, p.label));
  }
  out.end();
  const ok = results.filter(r => r.result === 'PASS' && /THE SKY IS GREEN|JARVIS TEST OK/.test(r.renderedResponse || ''));
  console.log(JSON.stringify({ event: 'SUMMARY', convId, count: results.length, exactMatch: ok.length }));
  process.exit(0);
} catch (err) {
  log({ event: 'FATAL', error: String(err?.message || err) });
  out.end();
  process.exit(1);
}
