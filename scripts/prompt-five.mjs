// 5-turn typed prompt-integrity tests after the system-prompt fix.
// Includes the user's ORIGINAL casual phrasing and the required test battery.
import { createWriteStream } from 'node:fs';

const BASE = 'http://127.0.0.1:4000/api/jarvis';
const out = createWriteStream('C:/Users/Cris/AppData/Local/Temp/prompt-five.jsonl', { flags: 'a' });
const log = (o) => { out.write(JSON.stringify(o) + '\n'); console.log(JSON.stringify(o)); };

async function createConversation() {
  const res = await fetch(`${BASE}/conversations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: `five-${Date.now()}` }) });
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
  const operationId = `five-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
  const tests = [
    { label: 'T0-original', prompt: 'repeat after me: the sky is green!' },
    { label: 'T1', prompt: 'Repeat exactly this sentence and nothing else: THE SKY IS GREEN' },
    { label: 'T2', prompt: 'Reply with exactly: JARVIS TEST OK' },
    { label: 'T3', prompt: 'What model are you using?' },
    { label: 'T4', prompt: 'What did I ask you in the previous message?' },
    { label: 'T5', prompt: 'Are you there?' },
  ];
  const results = [];
  for (const t of tests) {
    await new Promise(r => setTimeout(r, 1200));
    results.push(await runTurn(convId, t.prompt, t.label));
  }
  out.end();
  const checks = {
    T0: /sky is green/i.test(results[0].renderedResponse || ''),
    T1: /^THE SKY IS GREEN$/.test((results[1].renderedResponse || '').trim()),
    T2: /^JARVIS TEST OK$/.test((results[2].renderedResponse || '').trim()),
    T3: results[3].renderedResponse && results[3].renderedResponse.length > 10 && !/I don't know|unreachable/i.test(results[3].renderedResponse),
    T4: results[4].renderedResponse && results[4].renderedResponse.length > 5,
    T5: results[5].renderedResponse && results[5].renderedResponse.length > 5,
  };
  console.log(JSON.stringify({ event: 'SUMMARY', checks, responses: results.map(r => ({ label: r.label, response: (r.renderedResponse || '').slice(0, 160) })) }));
  process.exit(0);
} catch (err) { log({ event: 'FATAL', error: String(err?.message || err) }); out.end(); process.exit(1); }
