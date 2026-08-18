// Prompt hierarchy: CONTAMINATED-history test.
// Seed a conversation with 10+ unrelated debugging/CodeX/provider/listening
// churn, then ask the 5 required questions. Must work despite contamination.
import { createWriteStream } from 'node:fs';

const BASE = 'http://127.0.0.1:4000/api/jarvis';
const out = createWriteStream('C:/Users/Cris/AppData/Local/Temp/ph-contam.jsonl', { flags: 'a' });
const log = (o) => { out.write(JSON.stringify(o) + '\n'); console.log(JSON.stringify(o)); };

async function createConversation() {
  const res = await fetch(`${BASE}/conversations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: `ph-contam-${Date.now()}` }) });
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
  const operationId = `phc-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
  // Seed 12 unrelated churn turns (debugging/CodeX/provider/listening)
  const churn = [
    'Why is the CodeX goal stuck in waiting_for_approval?',
    'What provider is assigned to agent-jarvis?',
    'Is the listening state stuck again?',
    'The Hermes gateway showed unreachable earlier.',
    'Can you check the background task status?',
    'What model did DeepSeek resolve to last time?',
    'The orb node highlights seem wrong.',
    'Did the run complete or fail?',
    'Why did the voice transcript come out garbled?',
    'What is the current execution state?',
    'Show me the gateway ledger entries.',
    'The blob color changes look random.',
  ];
  for (const p of churn) {
    await runTurn(convId, p, 'churn');
    await new Promise(r => setTimeout(r, 900));
  }
  await new Promise(r => setTimeout(r, 1500));
  // The 5 required questions
  const tests = [
    { label: 'Q1', prompt: 'What color is the sky on a clear day?' },
    { label: 'Q2', prompt: 'Repeat exactly: BLUE ELEPHANT' },
    { label: 'Q3', prompt: 'Are you there?' },
    { label: 'Q4', prompt: 'What model are you using?' },
    { label: 'Q5', prompt: 'What did I just ask you?' },
  ];
  const results = [];
  for (const t of tests) {
    await new Promise(r => setTimeout(r, 1200));
    results.push(await runTurn(convId, t.prompt, t.label));
  }
  out.end();
  const checks = {
    Q1: /blue|sky/i.test((results[0].renderedResponse || '')) && (results[0].renderedResponse || '').length < 120,
    Q2: /^BLUE ELEPHANT$/.test((results[1].renderedResponse || '').trim()),
    Q3: /(yes|here|listening|ready)/i.test((results[2].renderedResponse || '')) && !/gateway|codex|task|status/i.test((results[2].renderedResponse || '')),
    Q4: /laguna|openrouter|model/i.test((results[3].renderedResponse || '')) && !/inspect|gateway/i.test((results[3].renderedResponse || '')),
    Q5: /(sky|question|ask)/i.test((results[4].renderedResponse || '')) && (results[4].renderedResponse || '').length < 200,
  };
  const passed = Object.values(checks).filter(Boolean).length;
  console.log(JSON.stringify({ event: 'SUMMARY', checks, passed, total: 5, responses: results.map(r => ({ label: r.label, response: (r.renderedResponse || '').slice(0, 140) })) }));
  process.exit(0);
} catch (err) { log({ event: 'FATAL', error: String(err?.message || err) }); out.end(); process.exit(1); }
