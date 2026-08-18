// Shape proof v2: higher alpha threshold excludes the faint radial halo and
// measures the actual head membrane + rim.
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

const metrics = await app.evaluate(() => {
  const canvas = document.querySelector('[data-testid="jarvis-orb"]');
  const ctx = canvas.getContext('2d');
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = img.data;
  const W = canvas.width, H = canvas.height;
  const results = {};
  for (const [name, threshold] of [['membrane', 60], ['rim', 110]]) {
    const isLit = (x, y) => {
      const i = (y * W + x) * 4;
      return data[i + 3] > threshold;
    };
    let top = -1, bottom = -1;
    const rowLeft = new Array(H).fill(W), rowRight = new Array(H).fill(-1);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (isLit(x, y)) {
          if (x < rowLeft[y]) rowLeft[y] = x;
          if (x > rowRight[y]) rowRight[y] = x;
          if (top === -1) top = y;
          bottom = y;
        }
      }
    }
    if (top === -1) { results[name] = { empty: true }; continue; }
    const height = bottom - top;
    let maxWv = 0, maxRow = 0;
    for (let y = 0; y < H; y++) { const v = rowRight[y] - rowLeft[y]; if (v > maxWv) { maxWv = v; maxRow = y; } }
    const widthAt = (frac) => {
      const y = Math.round(top + height * frac);
      return rowRight[y] - rowLeft[y];
    };
    results[name] = {
      height, maxWidth: maxWv, aspectRatio: +(height / maxWv).toFixed(2),
      widestAtFrac: +((maxRow - top) / height).toFixed(2),
      wTopFrac: +(widthAt(0.25) / maxWv).toFixed(2),
      wMidFrac: +(widthAt(0.5) / maxWv).toFixed(2),
      wBottomFrac: +(widthAt(0.85) / maxWv).toFixed(2),
      // Head: widest in upper/mid cranium, chin clearly narrower, taller than wide.
      isHeadLike: (maxRow - top) / height < 0.5 && widthAt(0.85) / maxWv < 0.82 && height > maxWv,
    };
  }
  return results;
});
console.log('SHAPE2 ' + JSON.stringify(metrics, null, 1));
await browser.disconnect();
