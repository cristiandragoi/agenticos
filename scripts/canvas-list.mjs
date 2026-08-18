// Find all jarvis-orb canvases and their pixel stats.
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
await sleep(6000);
const info = await app.evaluate(() => {
  const canvases = [...document.querySelectorAll('canvas[data-testid="jarvis-orb"]')];
  return canvases.map((c) => {
    const r = c.getBoundingClientRect();
    const ctx = c.getContext('2d');
    let alphaMax = 0, alphaSum = 0, lit = 0;
    try {
      const img = ctx.getImageData(0, 0, c.width, c.height);
      for (let i = 3; i < img.data.length; i += 4) {
        if (img.data[i] > alphaMax) alphaMax = img.data[i];
        alphaSum += img.data[i];
        if (img.data[i] > 20) lit++;
      }
    } catch (e) { return { err: String(e).slice(0, 80) }; }
    return {
      w: c.width, h: c.height, rectW: Math.round(r.width), rectH: Math.round(r.height),
      state: c.getAttribute('data-orb-state'), alphaMax, alphaAvg: Math.round(alphaSum / (c.width * c.height)), lit,
    };
  });
});
console.log('CANVASES ' + JSON.stringify(info, null, 1));
await browser.disconnect();
