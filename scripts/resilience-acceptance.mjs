// Provider-resilience acceptance: 10 direct primary-success requests (TTFT
// capture, §9) + the 3 packaged typed prompts (§18), against the RUNNING
// deployed backend (same process the packaged GUI calls).
// No secrets are printed. Provider/model come from the SSE stream.
import fs from 'fs';
import path from 'path';

const API = 'http://127.0.0.1:4000/api';
const CONV = process.env.JARVIS_CONV || '';

function getConvId() {
  if (CONV) return CONV;
  // Find the most recent jarvis conversation via the DB? The API exposes
  // conversations list? Use a known-good one from env or fall back.
  throw new Error('JARVIS_CONV required');
}

async function postStream(url, body, timeoutMs = 60000) {
  const started = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return { httpStatus: res.status, body: text.slice(0, 300), events: [], error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const events = [];
  let sawFirstToken = false;
  let firstTokenMs = null;
  let doneEvent = null;
  let errorEvent = null;
  let lastProvider = null;
  let lastModel = null;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      let evt = 'message';
      let data = '';
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) evt = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      if (!data) continue;
      let parsed;
      try { parsed = JSON.parse(data); } catch { continue; }
      if (parsed.provider) lastProvider = parsed.provider;
      if (parsed.model) lastModel = parsed.model;
      if (parsed.type === 'token' || evt === 'chunk') {
        if (!sawFirstToken && parsed.delta) {
          sawFirstToken = true;
          firstTokenMs = Date.now() - started;
        }
      }
      if (evt === 'done' || parsed.type === 'done') { doneEvent = parsed; events.push({ evt, data: parsed }); break; }
      if (evt === 'error' || parsed.type === 'error') { errorEvent = parsed; events.push({ evt, data: parsed }); }
      else events.push({ evt, data: parsed });
    }
    if (doneEvent || errorEvent) break;
  }
  return {
    httpStatus: res.status,
    events,
    sawFirstToken,
    firstTokenMs,
    doneEvent,
    errorEvent,
    lastProvider,
    lastModel,
    totalMs: Date.now() - started
  };
}

async function main() {
  const convId = getConvId();
  const prompts = [
    'Are you there?',
    'What model are you using?',
    'Tell me in one sentence what you can do.',
    'Jarvis, are you there?',
    'What model are you using?',
    'Are you there?',
    'What model are you using?',
    'Jarvis, are you there?',
    'What model are you using?',
    'Are you there?'
  ];
  const out = [];
  for (let i = 0; i < prompts.length; i++) {
    const operationId = `resilience-acc-${Date.now()}-${i}`;
    const started = Date.now();
    const r = await postStream(
      `${API}/jarvis/conversations/${convId}/message/stream`,
      { prompt: prompts[i], operationId, approvalPolicy: 'auto' },
      90000
    );
    // Collect visible text
    let visible = '';
    for (const e of r.events) {
      if (e.evt === 'chunk' && e.data?.delta) visible += e.data.delta;
      if (e.data?.type === 'token' && e.data?.content) visible += e.data.content;
    }
    const row = {
      turn: i + 1,
      prompt: prompts[i],
      httpStatus: r.httpStatus,
      firstTokenMs: r.firstTokenMs,
      totalMs: r.totalMs,
      done: Boolean(r.doneEvent),
      error: r.errorEvent ? (r.errorEvent.data?.error || r.errorEvent.data?.reason || '').slice(0, 200) : null,
      provider: r.doneEvent?.data?.provider || r.lastProvider,
      model: r.doneEvent?.data?.model || r.lastModel,
      visiblePreview: visible.trim().slice(0, 120)
    };
    out.push(row);
    console.log(JSON.stringify(row));
    await new Promise((r2) => setTimeout(r2, 800));
  }
  const ok = out.filter((o) => o.done && !o.error && o.visiblePreview.length > 0);
  console.log('---SUMMARY---');
  console.log(JSON.stringify({ total: out.length, succeeded: ok.length, failed: out.length - ok.length }, null, 2));
  const ttfts = out.filter((o) => o.firstTokenMs != null).map((o) => o.firstTokenMs);
  if (ttfts.length) {
    ttfts.sort((a, b) => a - b);
    const med = ttfts[Math.floor(ttfts.length / 2)];
    console.log(`TTFT: min=${ttfts[0]} median=${med} max=${ttfts[ttfts.length - 1]} n=${ttfts.length}`);
  }
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
