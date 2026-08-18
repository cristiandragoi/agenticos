// Full transcript dump + search for probe turns.
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
await sleep(1500);
const out = await app.evaluate(() => {
  const sc = document.querySelector('[data-testid="jarvis-chat-scroll"]');
  if (!sc) return { err: 'no scroll' };
  const text = sc.innerText;
  const lines = text.split('\n');
  return {
    lineCount: lines.length,
    charLen: text.length,
    hasP11: text.includes('P11'),
    hasP5: text.includes('P5 conversation'),
    hasInspection: text.includes('I can go deeper'),
    last8: lines.slice(-8),
    first4: lines.slice(0, 4),
  };
});
console.log(JSON.stringify(out, null, 1));
await browser.disconnect();
