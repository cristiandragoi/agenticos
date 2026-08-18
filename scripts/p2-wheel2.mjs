// P2 wheel test: real scroll-up via CDP, append resistance, jump-to-latest.
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
await sleep(2500);

const measure = async (tag) => {
  const m = await app.evaluate(() => {
    const sc = document.querySelector('[data-testid="jarvis-chat-scroll"]');
    const jump = [...document.querySelectorAll('button')].find((x) => /jump to latest/i.test(x.textContent || ''));
    return sc ? { top: Math.round(sc.scrollTop), sh: sc.scrollHeight, ch: sc.clientHeight, jump: !!jump } : { err: 'no scroll' };
  });
  console.log(tag + ' ' + JSON.stringify(m));
  return m;
};

const scrollUp = async () => {
  await app.evaluate(() => {
    const sc = document.querySelector('[data-testid="jarvis-chat-scroll"]');
    if (sc) sc.scrollTo({ top: 0, behavior: 'auto' });
  });
  await sleep(600);
};

await measure('start');
// user scrolls up through history
await scrollUp();
await measure('afterScrollUp');
// append while scrolled up (send a turn; provider 402 appends an error line)
await app.evaluate(() => {
  const ta = document.querySelector('textarea');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
  if (setter) setter.call(ta, 'Iota twelve');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
});
await sleep(400);
await app.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.getAttribute('aria-label') === 'Send Message'); if (b) b.click(); });
await sleep(6000);
await measure('afterAppendWhileScrolledUp');
// jump-to-latest click
await app.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /jump to latest/i.test(x.textContent || '')); if (b) b.click(); });
await sleep(1000);
await measure('afterJump');
await browser.disconnect();
