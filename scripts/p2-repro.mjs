// Reproduce P2: fresh #/jarvis mount → transcript scroll position over time.
import puppeteer from 'puppeteer-core';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((p) => p.url().includes('file://')) || pages[0];
await app.goto('file:///B:/AgenticOS/dist/index.html', { waitUntil: 'load' });
await sleep(4000);
// startup-race gate: retry if the error screen shows
await app.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => /Retry connection/i.test(x.textContent || ''));
  if (b) b.click();
});
await sleep(6000);
await app.evaluate(() => { location.hash = '#/jarvis'; });
await sleep(3000);
// ensure the dock is open
await app.evaluate(() => {
  const t = [...document.querySelectorAll('button')].find((x) => /SHOW DOCK/i.test(x.textContent || ''));
  if (t) t.click();
});
await sleep(2500);
for (let i = 0; i < 6; i++) {
  const s = await app.evaluate((ti) => {
    const sc = document.querySelector('[data-testid="jarvis-chat-scroll"]');
    if (!sc) return { t: ti, err: 'no scroll' };
    return { t: ti, top: Math.round(sc.scrollTop), sh: sc.scrollHeight, ch: sc.clientHeight, atBottom: sc.scrollHeight - sc.scrollTop - sc.clientHeight < 140 };
  }, i);
  console.log(JSON.stringify(s));
  await sleep(2000);
}
await browser.disconnect();
