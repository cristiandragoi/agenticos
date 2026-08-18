// Check visibility state and rAF behavior.
import puppeteer from 'puppeteer-core';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((p) => p.url().includes('file://')) || pages[0];
const targets = await browser.targets();
const tgt = targets.find((t) => t.type() === 'page' && t.url().includes('file://'));
const cdp = await tgt.createCDPSession();
await cdp.send('Page.enable');
await app.evaluate(() => { location.hash = '#/jarvis'; });
await sleep(5000);
const info = await app.evaluate(async () => {
  return new Promise((resolve) => {
    let fired = 0;
    const t0 = performance.now();
    const check = () => {
      requestAnimationFrame(() => {
        fired++;
        if (performance.now() - t0 < 1000) check();
        else resolve({ visibility: document.visibilityState, rAFCount: fired, hasFocus: document.hasFocus() });
      });
    };
    check();
  });
});
console.log('VIS ' + JSON.stringify(info));
// Also check if the canvas drew at all now (maybe it did after focus).
const draw = await app.evaluate(() => {
  const c = document.querySelector('canvas[data-testid="jarvis-orb"]');
  const ctx = c.getContext('2d');
  const img = ctx.getImageData(0, 0, c.width, c.height);
  let alphaMax = 0;
  for (let j = 3; j < img.data.length; j += 4) { if (img.data[j] > alphaMax) alphaMax = img.data[j]; }
  return { alphaMax };
});
console.log('DRAW ' + JSON.stringify(draw));
await browser.disconnect();
