// LIVE voice-turn trace for the packaged app. Captures for a bounded window:
//   - renderer console (ConvTrace/InputOwnership/VoiceDiag/errors) via CDP
//   - window CustomEvents: jarvis:conv-trace, jarvis:voice-state,
//     jarvis:input-level (throttled), jarvis:playback-started/ended
//   - DOM tail of the Jarvis conversation (assistant message renders)
// All timestamped and written to $TEMP/jarvis_live_trace.txt.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const OUT = process.env.TEMP
  ? path.join(process.env.TEMP, 'jarvis_live_trace.txt')
  : path.join(os.tmpdir(), 'jarvis_live_trace.txt');
const DURATION_MS = Number(process.argv[2] || 100000);
fs.writeFileSync(OUT, `=== LIVE TRACE START ${new Date().toISOString()} ===\n`);
const log = (line) => {
  const ts = new Date().toISOString();
  const entry = `${ts} ${line}`;
  fs.appendFileSync(OUT, entry + '\n');
  console.log(entry);
};

const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const page = pages.find((p) => p.url().startsWith('file:')) || pages[0];
log(`PAGE: ${page.url()}`);

// Inject window event capture (in-page array drained by the loop below).
await page.evaluate(() => {
  if (!window.__vtLive) {
    window.__vtLive = [];
    const push = (type, detail) => {
      window.__vtLive.push({ t: Date.now(), type, detail });
      if (window.__vtLive.length > 2000) window.__vtLive.splice(0, window.__vtLive.length - 2000);
    };
    const convTrace = (e) => push('conv-trace', e.detail);
    const voiceState = (e) => push('voice-state', e.detail);
    const inputLevel = (() => { let last = 0; let lastT = 0; return (e) => { const n = Date.now(); if (n - lastT >= 400) { lastT = n; push('input-level', { level: Math.round(e.detail.level * 100) / 100 }); } }; })();
    const playback = (e) => push('playback', { kind: e.type, agentId: e.detail?.agentId });
    window.addEventListener('jarvis:conv-trace', convTrace);
    window.addEventListener('jarvis:voice-state', voiceState);
    window.addEventListener('jarvis:input-level', inputLevel);
    window.addEventListener('jarvis:playback-started', playback);
    window.addEventListener('jarvis:playback-ended', playback);
  }
});

// CDP console capture
page.on('console', (msg) => {
  let text = '';
  try { text = msg.text(); } catch { /* ignore */ }
  if (text.length > 300) text = text.slice(0, 300);
  log(`CONSOLE[${msg.type()}] ${text}`);
});
page.on('pageerror', (err) => log(`PAGEERROR ${String(err && err.message ? err.message : err).slice(0, 300)}`));

let lastTail = '';
const t0 = Date.now();
while (Date.now() - t0 < DURATION_MS) {
  // Drain window events
  try {
    const events = await page.evaluate(() => { const a = window.__vtLive || []; window.__vtLive = []; return a; });
    for (const ev of events) {
      let d = '';
      try { d = JSON.stringify(ev.detail || {}); } catch { d = String(ev.detail); }
      log(`EVENT ${ev.type} ${d.slice(0, 200)}`);
    }
  } catch (e) { log(`DRAIN_ERR ${String(e.message).slice(0, 120)}`); }

  // DOM tail snapshot (assistant renders change the conversation tail)
  try {
    const tail = await page.evaluate(() => document.body.innerText.slice(-700));
    if (tail !== lastTail && tail.length > 50) {
      const prev = lastTail;
      lastTail = tail;
      if (prev !== '') {
        // Only report the delta-ish: new tail start
        let common = 0;
        while (common < prev.length && common < tail.length && prev[common] === tail[common]) common += 1;
        const delta = tail.slice(Math.max(0, common - 80));
        log(`DOM_TAIL_CHANGED ${JSON.stringify(delta.slice(0, 500))}`);
      } else {
        log(`DOM_TAIL_INIT len=${tail.length}`);
      }
    }
  } catch (e) { log(`DOM_ERR ${String(e.message).slice(0, 120)}`); }

  await new Promise((r) => setTimeout(r, 1000));
}
log(`=== LIVE TRACE END (${DURATION_MS}ms) → ${OUT} ===`);
await browser.disconnect();
