// High-frequency diagnostic: sample the v2 root state attr + region
// opacities during a real Jarvis turn (via the page composer).
import puppeteer from 'puppeteer-core';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((p) => p.url().includes('file://')) || pages[0];
await app.evaluate(() => { location.hash = '#/jarvis'; });
await sleep(7000);

const sample = () => app.evaluate(() => {
  const wrap = document.querySelector('[data-testid="jarvis-orb"]');
  const root = wrap.querySelector('.jhv-root');
  const g = (sel) => { const el = wrap.querySelector(sel); return el ? el.style.opacity || getComputedStyle(el).opacity : null; };
  return {
    orb: wrap.getAttribute('data-orb-state'),
    jhv: root ? root.getAttribute('data-jarvis-state') : null,
    eyes: g('.jhv-eyes'), brain: g('.jhv-brain'), chest: g('.jhv-chest'),
  };
});

const trace = [await sample()];
await app.evaluate(() => {
  const ta = document.querySelector('[data-testid="jarvis-composer-textarea"], textarea');
  if (!ta) return;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
  if (setter) setter.call(ta, 'Reply with exactly: V2_OK');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
});
await sleep(300);
await app.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => /send/i.test(b.textContent || ''));
  if (btn) btn.click();
});
for (let i = 0; i < 24; i++) { await sleep(1000); trace.push(await sample()); }
console.log(JSON.stringify(trace, null, 1));
await browser.disconnect();
