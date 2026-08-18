// Phase 14 runtime timing proof — drive a reproducible runtime turn through
// the REAL packaged renderer (voice channel), read the measured timeline from
// the window probe, and separately measure the server fast-path latency for
// presence prompts. No simulated values: every number is Date.now() on the
// actual production path.
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, 'p3-shots', 'voice-reliability');
mkdirSync(OUT_DIR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((p) => p.url().includes('file://')) || pages[0];

const url = await app.evaluate(() => location.href);
if (!url.includes('#/jarvis')) {
  await app.evaluate(() => { location.hash = '#/jarvis'; });
  await sleep(8000);
}

// Ensure the timeline probe is installed (hook mounts on /jarvis).
await sleep(1500);

// ── 1. Server fast-path latency (presence) — direct API measurement ──
async function measureServerFastPath(prompt) {
  // Find the active conversation first.
  const convRes = await fetch('http://127.0.0.1:4000/api/jarvis/conversations');
  const convs = await convRes.json();
  const convId = Array.isArray(convs) && convs.length ? convs[convs.length - 1].id : null;
  const t0 = Date.now();
  const res = await fetch(`http://127.0.0.1:4000/api/jarvis/conversations/${convId}/message/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, operationId: `timing-${Date.now()}`, inputChannel: 'voice', approvalPolicy: 'auto' }),
  });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let firstChunkAt = null;
  let doneAt = null;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    for (const frame of buffer.split('\n\n')) {
      if (frame.startsWith('event: chunk')) { if (firstChunkAt === null) firstChunkAt = Date.now() - t0; }
      if (frame.startsWith('event: done')) { doneAt = Date.now() - t0; }
    }
    buffer = buffer.slice(buffer.lastIndexOf('\n\n') + 2);
    if (doneAt !== null) break;
  }
  return { prompt, firstChunkMs: firstChunkAt, doneMs: doneAt };
}

const serverResults = [];
for (const p of ['Jarvis, are you there?', 'What is Agentic OS?', 'Jarvis, what does Hermes do?']) {
  try { serverResults.push(await measureServerFastPath(p)); } catch (e) { serverResults.push({ prompt: p, error: String(e).slice(0, 120) }); }
  await sleep(500);
}

// ── 2. Renderer reproducible turn — voice-channel send, timeline probe ──
// Reset the probe, then drive the REAL page send path with inputChannel
// 'voice' (same pipeline the mic auto-submit uses, minus the STT segment).
await app.evaluate(() => {
  try { if (window.__voiceTimelineGet) window.__voiceTimeline = []; } catch {}
});
const rendererBefore = await app.evaluate(() => {
  try { return window.__voiceTimelineGet ? window.__voiceTimelineGet() : null; } catch { return null; }
});
// Drive a presence prompt through the page's actual composer+send path.
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
    btn.click();
    // Poll the timeline probe until playback starts or 12s elapses.
    const t0 = Date.now();
    const poll = () => {
      let tl = null;
      try { tl = window.__voiceTimelineGet ? window.__voiceTimelineGet() : null; } catch {}
      const entries = (tl && tl.entries) || [];
      const hasPlayback = entries.some((e) => e.key === 'audioPlaybackStartAt');
      if (hasPlayback || Date.now() - t0 > 12000) {
        resolve({ timeline: entries, elapsedMs: Date.now() - t0 });
      } else {
        setTimeout(poll, 300);
      }
    };
    setTimeout(poll, 300);
  });
});

writeFileSync(path.join(OUT_DIR, 'timing.json'), JSON.stringify({ serverResults, rendererBefore, rendererResult }, null, 2));
console.log('VOICE_TIMING ' + JSON.stringify({ serverResults, rendererResult }, null, 2));
await browser.disconnect();
