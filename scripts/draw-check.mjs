// Reload, then immediately check the canvas drew (synchronous first frame).
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
await sleep(4000);
const s = await app.evaluate(() => {
  const c = document.querySelector('canvas[data-testid="jarvis-orb"]');
  const ctx = c.getContext('2d');
  const img = ctx.getImageData(0, 0, c.width, c.height);
  let alphaMax = 0, lit = 0;
  for (let j = 3; j < img.data.length; j += 4) { if (img.data[j] > alphaMax) alphaMax = img.data[j]; if (img.data[j] > 20) lit++; }
  return {
    alphaMax, lit,
    state: c.getAttribute('data-orb-state'),
    label: document.querySelector('[data-testid="jarvis-orb-status-label"]')?.textContent.trim(),
  };
});
console.log('DRAW ' + JSON.stringify(s));
await browser.disconnect();
