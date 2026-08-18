// PHASE 15 runtime proof — latency + voice identity + current-work routing
// against the LIVE deployed packaged app (CDP 9223, backend 4000).
// No simulated values: every number is Date.now() on the real production path.
import p from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, 'p3-shots', 'voice-p15');
mkdirSync(OUT_DIR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = 'http://127.0.0.1:4000';

const browser = await p.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((x) => x.url().includes('index.html')) || pages[0];
const url = await app.evaluate(() => location.href);
if (!url.includes('#/jarvis')) {
  await app.evaluate(() => { location.hash = '#/jarvis'; });
  await sleep(8000);
}
await sleep(1500);

// ── 1. Server voice-channel latency (identical path voice turns use) ──
async function measure(prompt) {
  const convRes = await fetch(`${BASE}/api/jarvis/conversations`);
  const convs = await convRes.json();
  const convId = Array.isArray(convs) && convs.length ? convs[convs.length - 1].id : null;
  if (!convId) return { prompt, error: 'no conversation' };
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/jarvis/conversations/${convId}/message/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, operationId: `p15-${Date.now()}`, inputChannel: 'voice', approvalPolicy: 'auto' }),
  });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = ''; let firstChunkAt = null; let doneAt = null; let route = null; let model = null;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    for (const frame of buffer.split('\n\n')) {
      if (frame.startsWith('event: chunk') && firstChunkAt === null) firstChunkAt = Date.now() - t0;
      if (frame.startsWith('event: done')) {
        doneAt = Date.now() - t0;
        const m = frame.match(/data: ({.*})/);
        if (m) { try { const d = JSON.parse(m[1]); route = d.route; model = d.model; } catch {} }
      }
    }
    buffer = buffer.slice(buffer.lastIndexOf('\n\n') + 2);
    if (doneAt !== null) break;
  }
  return { prompt, firstChunkMs: firstChunkAt, doneMs: doneAt, route, model };
}

const p1 = await measure('Jarvis, are you there?');
const p2 = await measure('What is Agentic OS?');
const p3 = await measure('What are we currently working on?');
await sleep(500);
const p4 = await measure('Explain the difference between Hermes and CodeX in Agentic OS.');

// ── 2. Renderer composer turn (voice channel) — real page send path ──
await app.evaluate(() => {
  try { window.__voiceTimeline = []; } catch {}
});
const rendererResult = await app.evaluate(() => {
  return new Promise((resolve) => {
    const ta = document.querySelector('textarea[aria-label="Message Input"]');
    if (!ta) return resolve({ error: 'no composer' });
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, '');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    setter.call(ta, 'Jarvis, are you there?');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    const btn = document.querySelector('button[aria-label="Send Message"]');
    if (!btn) return resolve({ error: 'no send button' });
    const t0 = Date.now();
    btn.click();
    const poll = () => {
      let tl = null;
      try { tl = window.__voiceTimelineGet ? window.__voiceTimelineGet() : null; } catch {}
      const entries = (tl && tl.entries) || [];
      const hasPlayback = entries.some((e) => e.key === 'audioPlaybackStartAt');
      if (hasPlayback || Date.now() - t0 > 15000) {
        resolve({ timeline: entries, elapsedMs: Date.now() - t0 });
      } else setTimeout(poll, 300);
    };
    setTimeout(poll, 300);
  });
});

// ── 3. Voice identity — synthesis log over several turns ──
let identity = null;
try {
  identity = await app.evaluate(() => {
    const log = window.__voiceSynthesisLog ? window.__voiceSynthesisLog() : [];
    return {
      count: log.length,
      distinct: window.__voiceDistinctVoices ? window.__voiceDistinctVoices() : [],
      last: log.slice(-5).map((r) => ({ voiceId: r.voiceId, ttsProvider: r.ttsProvider, fallbackReason: r.fallbackReason, turnId: r.turnId })),
    };
  });
} catch (e) { identity = { error: String(e).slice(0, 120) }; }

// ── 4. Current-work routing against two runtime states ──
const cw1 = await measure('What are we currently working on?');
// Alter runtime state: create a background task via the live API.
try {
  await fetch(`${BASE}/api/background-tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'PHASE15_RUNTIME_PROOF_TASK', worker: 'hermes', projectId: null }),
  });
} catch {}
await sleep(800);
const cw2 = await measure('What are we working on?');
const cw3 = await measure("What's the current task?");

const out = { serverLatency: { p1, p2, p3, p4 }, rendererResult, identity, currentWork: { cw1, cw2, cw3 } };
writeFileSync(path.join(OUT_DIR, 'p15-proof.json'), JSON.stringify(out, null, 2));
console.log('P15_PROOF ' + JSON.stringify(out, null, 2));
await browser.disconnect();
