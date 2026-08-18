// Expand LIVE WORK + dump its content + check backend live-events.
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
// expand LIVE WORK
await app.evaluate(() => {
  const t = [...document.querySelectorAll('button')].find((x) => /LIVE WORK/i.test(x.textContent || '') && /SHOW/i.test(x.textContent || ''));
  if (t) t.click();
});
await sleep(2000);
const out = await app.evaluate(() => {
  const liveWork = [...document.querySelectorAll('*')].filter((el) => /LIVE WORK/.test(el.textContent || '') && el.children.length > 0 && el.children.length < 10).slice(-3);
  const text = document.body.innerText;
  const lwIdx = text.indexOf('LIVE WORK');
  return { liveWorkSnippet: text.slice(lwIdx, lwIdx + 900) };
});
console.log(out.liveWorkSnippet);
await app.screenshot({ path: 'scripts/p3-shots/live-work-open.png' });
await browser.disconnect();
