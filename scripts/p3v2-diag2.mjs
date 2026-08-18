// Fresh reload + real typed turn; sample v2 regions + verify the turn via
// the transcript panel (real evidence the turn ran).
import puppeteer from 'puppeteer-core';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((p) => p.url().includes('file://')) || pages[0];
await app.reload();
await sleep(9000);
await app.evaluate(() => { location.hash = '#/jarvis'; });
await sleep(4000);

const sample = () => app.evaluate(() => {
  const wrap = document.querySelector('[data-testid="jarvis-orb"]');
  if (!wrap) return null;
  const root = wrap.querySelector('.jhv-root');
  const g = (sel) => { const el = wrap.querySelector(sel); return el ? el.style.opacity || getComputedStyle(el).opacity : null; };
  return {
    orb: wrap.getAttribute('data-orb-state'),
    jhv: root ? root.getAttribute('data-jarvis-state') : null,
    eyes: g('.jhv-eyes'), brain: g('.jhv-brain'), chest: g('.jhv-chest'),
  };
});

const trace = [];
for (let i = 0; i < 3; i++) { trace.push(await sample()); await sleep(1000); }

// Send via composer (typed).
const sent = await app.evaluate(() => {
  const ta = document.querySelector('[data-testid="jarvis-composer-textarea"], textarea');
  if (!ta) return { ok: false, why: 'no textarea' };
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
  if (setter) setter.call(ta, 'Reply with exactly: V2_OK');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  return { ok: true };
});
await sleep(400);
await app.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => /send/i.test(b.textContent || '') || b.getAttribute('aria-label') === 'Send');
  if (btn) btn.click();
});

for (let i = 0; i < 30; i++) { await sleep(1000); trace.push(await sample()); }

// Transcript evidence: last agent reply text.
const transcript = await app.evaluate(() => {
  const el = document.querySelector('[data-testid="jarvis-transcript"], .transcript, [class*="transcript"]');
  if (!el) return null;
  const text = el.textContent || '';
  const m = text.match(/V2_OK/);
  return { hasReply: !!m, tail: text.slice(-300) };
});

console.log('SENT ' + JSON.stringify(sent));
console.log('TRANSCRIPT ' + JSON.stringify(transcript));
console.log('TRACE');
for (const t of trace) console.log(JSON.stringify(t));
await browser.disconnect();
