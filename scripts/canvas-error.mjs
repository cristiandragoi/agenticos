// Capture any runtime error in the canvas draw loop by monkeypatching.
import puppeteer from 'puppeteer-core';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((p) => p.url().includes('file://')) || pages[0];
const targets = await browser.targets();
const tgt = targets.find((t) => t.type() === 'page' && t.url().includes('file://'));
const cdp = await tgt.createCDPSession();
await cdp.send('Page.enable');
const errors = [];
app.on('pageerror', (e) => errors.push('PAGEERROR: ' + String(e).slice(0, 300)));
app.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text().slice(0, 300)); });
await app.evaluate(() => { location.hash = '#/jarvis'; });
await sleep(8000);
// Force a synchronous draw of the JarvisCore canvas by checking the frame.
const probe = await app.evaluate(() => {
  const c = document.querySelector('canvas[data-testid="jarvis-orb"]');
  const ctx = c.getContext('2d');
  // Read a single pixel row after forcing a manual frame via rAF promise.
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        try {
          const img = ctx.getImageData(0, 0, c.width, c.height);
          let alphaMax = 0;
          for (let j = 3; j < img.data.length; j += 4) { if (img.data[j] > alphaMax) alphaMax = img.data[j]; }
          resolve({ alphaMax, w: c.width, h: c.height, dpr: window.devicePixelRatio });
        } catch (e) { resolve({ err: String(e).slice(0, 200) }); }
      });
    });
  });
});
console.log('PROBE ' + JSON.stringify(probe));
console.log('ERRORS ' + JSON.stringify(errors.slice(-6)));
await browser.disconnect();
