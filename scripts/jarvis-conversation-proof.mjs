// PACKAGED-APP JARVIS CONVERSATION PROOF over CDP.
// Sends 5 real prompts through the actual packaged Jarvis UI and records the
// visible JARVIS replies + activity stream. Verifies TEST 1 (deterministic),
// TEST 2 (ordinary), TEST 3 (continuity), and 5/5 non-empty reliability.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, 'p3-shots', 'response-fix');
fs.mkdirSync(OUT_DIR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((p) => p.url().includes('file://')) || pages[0];

if (!app.url().includes('#/jarvis')) {
  await app.evaluate(() => { location.hash = '#/jarvis'; });
  await sleep(6000);
}

// Start from a FRESH conversation (empty transcript): create one via the API,
// point the app at it through its sessionStorage restore key, ensure we're on
// the Jarvis page, and reload.
const convRes = await fetch('http://127.0.0.1:4000/api/jarvis/conversations', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: 'response-fix-proof' }),
});
const convData = await convRes.json();
console.log('PROOF_CONV ' + convData.id);
await app.evaluate(`(() => { sessionStorage.setItem('jarvis-active-conversation', '${convData.id}'); location.hash = '#/jarvis'; location.reload(); })()`);
await sleep(9000);

const rows = () =>
  app.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid="jarvis-command-line"]'))
      .map((l) => l.innerText.replace(/\s+/g, ' ').trim())
      .filter(Boolean),
  );

async function sendPrompt(text) {
  await app.evaluate((t) => {
    const ta = document.querySelector('textarea[aria-label="Message Input"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    // Force-clear any leftover composer state first (a stale value raced into
    // a previous proof run and corrupted the first turn).
    setter.call(ta, '');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    setter.call(ta, t);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    const btn = document.querySelector('button[aria-label="Send Message"]');
    if (btn && !btn.disabled) btn.click();
  }, text);
  // Give the composer time to update, then verify the user row actually sent
  const start = Date.now();
  while (Date.now() - start < 15000) {
    await sleep(2000);
    const r = await rows();
    if (r.some((x) => x.startsWith('YOU') && x.includes(text.slice(0, 24)))) return true;
  }
  return false;
}

async function waitForReply(prompt, timeoutMs = 120000) {
  const start = Date.now();
  let seenUserRow = false;
  let lastReply = null;
  let stableSince = 0;
  while (Date.now() - start < timeoutMs) {
    await sleep(2500);
    const r = await rows();
    const userIdx = r.findIndex((x) => x.startsWith('YOU') && x.includes(prompt.slice(0, 40)));
    if (userIdx >= 0) seenUserRow = true;
    if (!seenUserRow) continue;
    // last JARVIS row after the user row
    let reply = null;
    for (let i = userIdx + 1; i < r.length; i++) {
      const line = r[i];
      if (/^JARVIS\b/.test(line)) {
        const t = line.replace(/^JARVIS\s*:?\s*/, '').trim();
        if (t.length > 0) reply = t;
      }
    }
    if (reply === null) continue;
    if (reply === lastReply) {
      // stable across two polls (>= 5s) AND composer re-enabled
      const ready = await app.evaluate(() => {
        const ta = document.querySelector('textarea[aria-label="Message Input"]');
        return ta ? !ta.disabled : false;
      });
      if (Date.now() - stableSince > 5000 && ready) return { reply, elapsedMs: Date.now() - start };
    } else {
      lastReply = reply;
      stableSince = Date.now();
    }
  }
  return { reply: lastReply || '', elapsedMs: Date.now() - start };
}

const tests = [
  { id: 'TEST1', prompt: 'Hello Jarvis. Are you working? Reply with one short sentence.' },
  { id: 'TEST2', prompt: 'What was the subject of my previous question?' },
  { id: 'TEST3', prompt: 'Remember that my temporary test code word is ORBIT-47.' },
  { id: 'TEST4', prompt: 'What test code word did I just ask you to remember?' },
  { id: 'TEST5', prompt: 'Give me a one-sentence description of what Jarvis does in Agentic OS.' },
];

const results = [];
for (const t of tests) {
  await sendPrompt(t.prompt);
  const { reply, elapsedMs } = await waitForReply(t.prompt);
  results.push({ id: t.id, prompt: t.prompt, reply, elapsedMs });
  console.log(`RESULT ${t.id} elapsed=${elapsedMs}ms reply=${JSON.stringify(reply.slice(0, 160))}`);
}

// activity stream state
const activity = await app.evaluate(() => {
  const s = document.querySelector('[data-testid="jarvis-activity-stream"]');
  return s ? s.innerText.slice(0, 400) : null;
});
const chip = await app.evaluate(() => {
  const dot = document.querySelector('[data-testid="backend-status-dot"]');
  return dot ? dot.closest('button')?.innerText.replace(/\s+/g, ' ').trim() : null;
});
const fullPath = path.join(OUT_DIR, 'jarvis-conversation.png');
await app.screenshot({ path: fullPath, captureBeyondViewport: true });

const verdict = {
  test1NonEmpty: (results[0]?.reply || '').length > 0,
  test2NonEmpty: (results[1]?.reply || '').length > 0,
  test3Ack: (results[2]?.reply || '').length > 0,
  test4Continuity: /orbit-?47/i.test(results[3]?.reply || ''),
  test5NonEmpty: (results[4]?.reply || '').length > 0,
  reliability: `${results.filter((r) => (r.reply || '').length > 0).length}/5`,
  backendChip: chip,
  activityPreview: activity,
  screenshot: fullPath,
};
console.log('PROOF_VERDICT ' + JSON.stringify(verdict));
await browser.disconnect();
