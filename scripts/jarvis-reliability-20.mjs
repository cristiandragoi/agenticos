// 20-turn NORMAL Jarvis path reliability gate (fixed SSE parser).
// Reads the SSE `event:` header — the JSON payload has no type field.
import { createWriteStream } from 'node:fs';

const BASE = 'http://127.0.0.1:4000/api/jarvis';
const out = createWriteStream(process.env.RESULT_FILE || 'C:/Users/Cris/AppData/Local/Temp/jarvis20.jsonl', { flags: 'a' });
const log = (o) => { out.write(JSON.stringify(o) + '\n'); console.log(JSON.stringify(o)); };

async function createConversation() {
  const res = await fetch(`${BASE}/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: `reliability-${Date.now()}` })
  });
  if (!res.ok) throw new Error(`create conv failed: HTTP ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.conversation?.id || data.id || data.conversationId;
}

// Parse an SSE data payload + event line into {event, data}
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
    if (data) {
      try { frames.push({ event, data: JSON.parse(data) }); } catch { /* ignore malformed */ }
    }
  }
  return frames;
}

async function runTurn(convId, prompt, turnIdx) {
  const started = Date.now();
  const operationId = `rel-${turnIdx}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const record = { turn: turnIdx, prompt, operationId, startedAt: new Date().toISOString() };
  try {
    const res = await fetch(`${BASE}/conversations/${convId}/message/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, operationId })
    });
    record.httpStatus = res.status;
    record.headersAt = Date.now() - started;
    if (!res.ok || !res.body) {
      record.result = 'HTTP_FAIL';
      record.error = await res.text().catch(() => '');
      log(record);
      return record;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let firstTokenMs = null;
    let firstVisibleMs = null;
    let sawToken = false;
    let sawDone = false;
    let errorChunk = null;
    let provider = null, model = null;
    let finalText = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const frameText = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        for (const { event, data } of parseFrames(frameText)) {
          const now = Date.now() - started;
          if (event === 'timing' && data?.marker === 'first_token' && firstTokenMs === null) {
            firstTokenMs = now;
            provider = data.provider || provider;
            model = data.model || model;
          } else if (event === 'chunk') {
            if (firstTokenMs === null) firstTokenMs = now;
            if (!sawToken) { sawToken = true; firstVisibleMs = now; }
            finalText += data?.delta || '';
            provider = data?.provider || provider;
            model = data?.model || model;
          } else if (event === 'error') {
            errorChunk = data?.error || data?.reason || 'error';
            provider = data?.provider || provider;
            model = data?.model || model;
          } else if (event === 'done') {
            sawDone = true;
            provider = data?.provider || provider;
            model = data?.model || model;
            if (record.firstTokenMs == null && data?.firstTokenMs != null) record.firstTokenMs = data.firstTokenMs;
            if (record.totalMs == null && data?.totalMs != null) record.totalMs = data.totalMs;
          }
        }
      }
    }
    record.firstTokenMs = record.firstTokenMs ?? firstTokenMs;
    record.firstVisibleMs = firstVisibleMs;
    record.sawToken = sawToken;
    record.sawDone = sawDone;
    record.errorChunk = errorChunk;
    record.provider = provider;
    record.model = model;
    record.responseLength = finalText.length;
    record.responsePreview = finalText.slice(0, 120);
    record.totalMs = record.totalMs ?? (Date.now() - started);
    record.result = sawDone && sawToken && !errorChunk ? 'PASS' : (errorChunk ? 'ERROR' : (sawDone ? 'EMPTY_DONE' : 'NO_DONE'));
    log(record);
  } catch (err) {
    record.result = 'EXCEPTION';
    record.error = String(err?.message || err);
    record.elapsedMs = Date.now() - started;
    log(record);
  }
  return record;
}

const prompts = [
  'Jarvis, are you there?',
  'What model are you using?',
  'Jarvis, are you there?',
  'What model are you using?',
  'Jarvis, are you there?',
  'What model are you using?',
  'Jarvis, are you there?',
  'What model are you using?',
  'Jarvis, are you there?',
  'What model are you using?',
  'Jarvis, are you there?',
  'What model are you using?',
  'Jarvis, are you there?',
  'What model are you using?',
  'Jarvis, are you there?',
  'What model are you using?',
  'Jarvis, are you there?',
  'What model are you using?',
  'Jarvis, are you there?',
  'What model are you using?',
];

try {
  const convId = await createConversation();
  log({ event: 'CONV_CREATED', convId });
  const results = [];
  for (let i = 0; i < prompts.length; i++) {
    await new Promise(r => setTimeout(r, 1200));
    results.push(await runTurn(convId, prompts[i], i + 1));
  }
  const passed = results.filter(r => r.result === 'PASS').length;
  const failed = results.filter(r => r.result !== 'PASS');
  const ttfts = results.map(r => r.firstTokenMs).filter(v => v != null);
  const completions = results.map(r => r.totalMs).filter(v => v != null);
  const med = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const p95 = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)]; };
  log({ event: 'SUMMARY', convId, passed, total: prompts.length, failedCount: failed.length, failures: failed.map(f => ({ turn: f.turn, result: f.result, error: f.error || f.errorChunk })), medianTTFT: med(ttfts), p95TTFT: p95(ttfts), medianCompletion: med(completions), p95Completion: p95(completions), all: results.map(r => ({ turn: r.turn, result: r.result, ttft: r.firstTokenMs, total: r.totalMs, provider: r.provider, model: r.model })) });
  out.end();
  process.exit(passed === prompts.length ? 0 : 2);
} catch (err) {
  log({ event: 'FATAL', error: String(err?.message || err) });
  out.end();
  process.exit(1);
}
