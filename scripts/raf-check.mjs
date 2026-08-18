// Check if rAF fires after bringToFront + measure frame rate over 3s.
import puppeteer from 'puppeteer-core';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((p) => p.url().includes('file://')) || pages[0];
const targets = await browser.targets();
const tgt = targets.find((t) => t.type() === 'page' && t.url().includes('file://'));
const cdp = await tgt.createCDPSession();
await cdp.send('Page.enable');
await cdp.send('Page.bringToFront');
await sleep(2000);
const info = await app.evaluate(async () => {
  return new Promise((resolve) => {
    let count = 0;
    const t0 = performance.now();
    const tick = () => {
      count++;
      if (performance.now() - t0 < 3000) requestAnimationFrame(tick);
      else resolve({ count, visibility: document.visibilityState, hasFocus: document.hasFocus(), elapsed: Math.round(performance.now() - t0) });
    };
    requestAnimationFrame(tick);
  });
});
console.log('RAF ' + JSON.stringify(info));
await browser.disconnect();
