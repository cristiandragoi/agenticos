// Phase 15 runtime proof part 2: multiple voice turns for identity persistence,
// plus the actual current-work reply text to prove state-derived truth.
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

async function sendAndWait(prompt) {
  return app.evaluate((p) => {
    return new Promise((resolve) => {
      const ta = document.querySelector('textarea[aria-label="Message Input"]');
      if (!ta) return resolve({ error: 'no composer' });
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, '');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      setter.call(ta, p);
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
  }, prompt);
}

const turns = [];
for (const q of [
  'Jarvis, are you there?',
  'What is Agentic OS?',
  'What does Jarvis do?',
  'Jarvis, are you still there?',
  'What is Agentic OS?',
]) {
  try { turns.push(await sendAndWait(q)); } catch (e) { turns.push({ error: String(e).slice(0, 120) }); }
  await sleep(2500);
}

const identity = await app.evaluate(() => {
  const log = window.__voiceSynthesisLog ? window.__voiceSynthesisLog() : [];
  return {
    count: log.length,
    distinct: window.__voiceDistinctVoices ? window.__voiceDistinctVoices() : [],
    records: log.slice(-12).map((r) => ({ voiceId: r.voiceId, ttsProvider: r.ttsProvider, fallbackReason: r.fallbackReason, turnId: r.turnId, at: r.at })),
  };
});

// Actual current-work reply text from the persisted conversation.
const convRes = await fetch(`${BASE}/api/jarvis/conversations`);
const convs = await convRes.json();
const convId = Array.isArray(convs) && convs.length ? convs[convs.length - 1].id : null;
let currentWorkTexts = [];
if (convId) {
  const msgsRes = await fetch(`${BASE}/api/jarvis/conversations/${convId}/messages`);
  const msgs = await msgsRes.json();
  if (Array.isArray(msgs)) {
    currentWorkTexts = msgs
      .filter((m) => m?.role === 'agent' && /current-work-context|current_work|working on/i.test(String(m?.content || '')) || (m?.metadata?.model === 'current-work-context'))
      .slice(-4)
      .map((m) => ({ content: String(m.content || '').slice(0, 300), model: m.metadata?.model, at: m.createdAt }));
  }
}

const out = { turns, identity, currentWorkTexts };
writeFileSync(path.join(OUT_DIR, 'p15-proof2.json'), JSON.stringify(out, null, 2));
console.log('P15_PROOF2 ' + JSON.stringify(out, null, 2));
await browser.disconnect();
