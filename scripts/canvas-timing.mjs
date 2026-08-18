// Read the canvas repeatedly to see if the rAF loop draws over time.
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
await sleep(500);
await cdp.send('Page.reload');
for (let i = 0; i < 8; i++) {
  await sleep(2000);
  const s = await app.evaluate(() => {
    const c = document.querySelector('canvas[data-testid="jarvis-orb"]');
    const ctx = c.getContext('2d');
    const img = ctx.getImageData(0, 0, c.width, c.height);
    let alphaMax = 0, lit = 0;
    for (let j = 3; j < img.data.length; j += 4) {
      if (img.data[j] > alphaMax) alphaMax = img.data[j];
      if (img.data[j] > 20) lit++;
    }
    return {
      alphaMax, lit,
      rect: c.getBoundingClientRect().width,
      reduced: c.getAttribute('data-reduced-motion'),
      state: c.getAttribute('data-orb-state'),
      rAFWorking: typeof requestAnimationFrame === 'function',
    };
  });
  console.log('T+' + ((i + 1) * 2) + 's ' + JSON.stringify(s));
}
await browser.disconnect();
