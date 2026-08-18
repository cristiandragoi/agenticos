// Did the probe turn fire? Check the last transcript lines precisely.
import puppeteer from 'puppeteer-core';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((p) => p.url().includes('file://')) || pages[0];
await app.goto('file:///B:/AgenticOS/dist/index.html', { waitUntil: 'load' });
await sleep(4000);
await app.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => /Retry connection/i.test(x.textContent || ''));
  if (b) b.click();
});
await sleep(6000);
await app.evaluate(() => { location.hash = '#/jarvis'; });
await sleep(2500);
await app.evaluate(() => {
  const t = [...document.querySelectorAll('button')].find((x) => /SHOW DOCK/i.test(x.textContent || ''));
  if (t) t.click();
});
await sleep(2000);
// send a turn, then read the LAST transcript lines from the DOM
await app.evaluate(() => {
  const ta = document.querySelector('textarea');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
  if (setter) setter.call(ta, 'Activity probe two');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
});
await sleep(500);
const val = await app.evaluate(() => document.querySelector('textarea')?.value);
await app.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.getAttribute('aria-label') === 'Send Message'); if (b) b.click(); });
await sleep(4000);
const out = await app.evaluate(() => {
  const tr = document.querySelector('[data-testid="jarvis-transcript"]') || document.querySelector('.transcript');
  const lines = tr ? tr.innerText.split('\n').slice(-14) : [];
  const sc = document.querySelector('[data-testid="jarvis-chat-scroll"]');
  return { textareaVal: document.querySelector('textarea')?.value, lastLines: lines, scrollSh: sc ? sc.scrollHeight : null };
});
console.log(JSON.stringify(out, null, 1));
await browser.disconnect();
