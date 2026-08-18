// Programmatic shape proof: sample the Jarvis canvas pixels and compute
// silhouette metrics. A head: taller than wide, widest in upper third,
// tapers at the chin (bottom). A circle: equal extents, widest at middle.
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
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = img.data;
  const W = canvas.width, H = canvas.height;
  // Threshold: any non-background pixel (alpha > 24 or brightness above bg).
  const isLit = (x, y) => {
    const i = (y * W + x) * 4;
    return data[i + 3] > 28;
  };
  // Row widths (left/right extents of lit pixels per row).
  const rowLeft = new Array(H).fill(W), rowRight = new Array(H).fill(-1);
  let top = -1, bottom = -1;
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
  const widthAt = (frac) => {
    const y = Math.round(top + (bottom - top) * frac);
    return rowRight[y] - rowLeft[y];
  };
  const height = bottom - top;
  const wTop = widthAt(0.25);   // upper head (cranium/temples)
  const wMid = widthAt(0.5);    // mid face
  const wBottom = widthAt(0.85); // chin region
  const maxW = Math.max(...rowRight.map((r, i) => r - rowLeft[i]).filter((v) => v > 0));
  // Find the row with max width.
  let maxRow = 0, maxWv = 0;
  for (let y = 0; y < H; y++) { const v = rowRight[y] - rowLeft[y]; if (v > maxWv) { maxWv = v; maxRow = y; } }
  const maxFrac = (maxRow - top) / height;
  return {
    height, maxWidth: maxWv, aspectRatio: height / maxWv,
    wTopFrac: wTop / maxWv, wMidFrac: wMid / maxWv, wBottomFrac: wBottom / maxWv,
    widestAtFrac: maxFrac,
    // Circle signature: widest at 0.5, width symmetric. Head: widest < 0.5 (upper), tapers below.
    isHeadLike: maxFrac < 0.48 && wBottomFrac < 0.9 && height > maxWv,
  };
});
console.log('SHAPE ' + JSON.stringify(metrics, null, 1));
await browser.disconnect();
