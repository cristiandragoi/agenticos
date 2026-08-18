// Dump the continuation reply from the transcript.
import puppeteer from 'puppeteer-core';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((p) => p.url().includes('file://')) || pages[0];
await app.goto('file:///B:/AgenticOS/dist/index.html', { waitUntil: 'load' });
await sleep(3000);
await app.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => /Retry connection/i.test(x.textContent || ''));
  if (b) b.click();
});
await sleep(5000);
await app.evaluate(() => { location.hash = '#/jarvis'; });
await sleep(2500);
const out = await app.evaluate(() => {
  const sc = document.querySelector('[data-testid="jarvis-chat-scroll"]');
  const text = sc ? sc.innerText : '';
  const i3 = text.lastIndexOf('Continue where we left off.');
  return {
    cont: i3 >= 0 ? text.slice(i3, i3 + 800).replace(/\n/g, ' | ') : 'MISSING',
    hasAgenticOS: text.includes('AgenticOS'),
    hasContinuity: text.includes('memory continuity'),
  };
});
console.log(JSON.stringify(out, null, 1));
await browser.disconnect();
