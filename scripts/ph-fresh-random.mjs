// Prompt hierarchy: FRESH conversation test (5 required questions) +
// 20-turn randomness test (factual/echo/context/self-state/greeting mix).
// Asserts NO random drift into task inspection/runtime dumps/refusals.
import { createWriteStream } from 'node:fs';

const BASE = 'http://127.0.0.1:4000/api/jarvis';
const out = createWriteStream('C:/Users/Cris/AppData/Local/Temp/ph-fresh.jsonl', { flags: 'a' });
const log = (o) => { out.write(JSON.stringify(o) + '\n'); console.log(JSON.stringify(o)); };

async function createConversation(title) {
  const res = await fetch(`${BASE}/conversations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: `${title}-${Date.now()}` }) });
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
  const operationId = `phf-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

// Drift markers that indicate an operational/runtime tangent or refusal
const DRIFT = /gateway|codex|background task|hermes gateway|runtime inspection|how can i help you today|won't repeat|i can't repeat|execution state|orb|listening state|transcri|task status|active task/i;

try {
  // ---- FRESH test ----
  const conv1 = await createConversation('ph-fresh');
  log({ event: 'FRESH_CONV', convId: conv1 });
  const freshTests = [
    { label: 'F1', prompt: 'What color is the sky on a clear day?' },
    { label: 'F2', prompt: 'Repeat exactly: BLUE ELEPHANT' },
    { label: 'F3', prompt: 'Are you there?' },
    { label: 'F4', prompt: 'What model are you using?' },
    { label: 'F5', prompt: 'What did I just ask you?' },
  ];
  const freshResults = [];
  for (const t of freshTests) {
    await new Promise(r => setTimeout(r, 1100));
    freshResults.push(await runTurn(conv1, t.prompt, t.label));
  }

  // ---- 20-turn randomness test ----
  const conv2 = await createConversation('ph-rand');
  log({ event: 'RAND_CONV', convId: conv2 });
  const randTests = [];
  const mix = [
    'What is the capital of France?',
    'Repeat exactly: RED ROVER',
    'Do you know my name?',
    'What color is grass?',
    'Say exactly: HELLO WORLD',
    'What timezone is this machine in?',
    'What did you just say?',
    'Is 2 plus 2 equal to 4?',
    'Repeat exactly: SEVEN SEAS',
    'What is your name?',
    'How many days are in a week?',
    'Say exactly: GOOD NIGHT',
    'What is the largest planet?',
    'What was my last question?',
    'Repeat exactly: MOON RIVER',
    'Are you feeling okay?',
    'What is the speed of light?',
    'Say exactly: TEA TIME',
    'What did you just say to me?',
    'Thank you, goodbye.',
  ];
  for (let i = 0; i < 20; i++) randTests.push({ label: `R${i + 1}`, prompt: mix[i] });
  const randResults = [];
  for (const t of randTests) {
    await new Promise(r => setTimeout(r, 900));
    randResults.push(await runTurn(conv2, t.prompt, t.label));
  }
  out.end();

  const freshChecks = {
    F1: /blue|sky/i.test((freshResults[0].renderedResponse || '')) && (freshResults[0].renderedResponse || '').length < 120,
    F2: /^BLUE ELEPHANT$/.test((freshResults[1].renderedResponse || '').trim()),
    F3: /(yes|here|listening|ready)/i.test((freshResults[2].renderedResponse || '')),
    F4: /laguna|openrouter|model/i.test((freshResults[3].renderedResponse || '')),
    F5: (freshResults[4].renderedResponse || '').length > 0 && (freshResults[4].renderedResponse || '').length < 300,
  };
  const freshPassed = Object.values(freshChecks).filter(Boolean).length;

  const driftCount = randResults.filter(r => DRIFT.test(r.renderedResponse || '')).length;
  const emptyCount = randResults.filter(r => !r.renderedResponse || r.renderedResponse.length < 2).length;
  const randPassed = 20 - driftCount - emptyCount;

  console.log(JSON.stringify({
    event: 'SUMMARY',
    fresh: { passed: freshPassed, total: 5, checks: freshChecks, responses: freshResults.map(r => ({ label: r.label, response: (r.renderedResponse || '').slice(0, 120) })) },
    rand: { passed: randPassed, total: 20, driftCount, emptyCount, drifts: randResults.filter(r => DRIFT.test(r.renderedResponse || '')).map(r => ({ label: r.label, response: (r.renderedResponse || '').slice(0, 120) })) },
  }));
  process.exit(0);
} catch (err) { log({ event: 'FATAL', error: String(err?.message || err) }); out.end(); process.exit(1); }
