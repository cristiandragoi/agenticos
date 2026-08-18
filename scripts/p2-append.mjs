// Does an appended message auto-scroll to bottom (effect works for appends)?
import puppeteer from 'puppeteer-core';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((p) => p.url().includes('file://')) || pages[0];
await app.evaluate(() => { location.hash = '#/jarvis'; });
await sleep(6000);
const before = await app.evaluate(() => {
  const sc = document.querySelector('[data-testid="jarvis-chat-scroll"]');
  return { scrollTop: Math.round(sc.scrollTop), scrollH: sc.scrollHeight, clientH: sc.clientHeight };
});
// send one message (appends to messages → effect should scroll)
await app.evaluate(() => {
  const ta = document.querySelector('textarea');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
  if (setter) setter.call(ta, 'Iota nine');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
});
await sleep(400);
await app.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.getAttribute('aria-label') === 'Send Message'); if (b) b.click(); });
await sleep(5000);
const after = await app.evaluate(() => {
  const sc = document.querySelector('[data-testid="jarvis-chat-scroll"]');
  return { scrollTop: Math.round(sc.scrollTop), scrollH: sc.scrollHeight, clientH: sc.clientHeight, atBottom: sc.scrollHeight - sc.scrollTop - sc.clientHeight < 140 };
});
console.log('BEFORE ' + JSON.stringify(before));
console.log('AFTER  ' + JSON.stringify(after));
await browser.disconnect();
