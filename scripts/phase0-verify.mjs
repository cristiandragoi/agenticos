// Phase 0 verification: humanoid head + Live Work in the live app.
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
await sleep(12000);

// Head shape proof (membrane threshold).
const shape = await app.evaluate(() => {
  const canvas = document.querySelector('[data-testid="jarvis-orb"]');
  const ctx = canvas.getContext('2d');
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = img.data;
  const W = canvas.width, H = canvas.height;
  const isLit = (x, y) => { const i = (y * W + x) * 4; return data[i + 3] > 60; };
  let top = -1, bottom = -1;
  const rowLeft = new Array(H).fill(W), rowRight = new Array(H).fill(-1);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (isLit(x, y)) { if (x < rowLeft[y]) rowLeft[y] = x; if (x > rowRight[y]) rowRight[y] = x; if (top === -1) top = y; bottom = y; }
  }
  if (top === -1) return { empty: true };
  const height = bottom - top;
  let maxWv = 0, maxRow = 0;
  for (let y = 0; y < H; y++) { const v = rowRight[y] - rowLeft[y]; if (v > maxWv) { maxWv = v; maxRow = y; } }
  const widthAt = (f) => { const y = Math.round(top + height * f); return rowRight[y] - rowLeft[y]; };
  return {
    aspect: +(height / maxWv).toFixed(2),
    widestAt: +((maxRow - top) / height).toFixed(2),
    chinFrac: +(widthAt(0.85) / maxWv).toFixed(2),
    isHeadLike: (maxRow - top) / height < 0.5 && widthAt(0.85) / maxWv < 0.82 && height > maxWv,
    state: canvas.getAttribute('data-orb-state'),
  };
});
console.log('HEAD ' + JSON.stringify(shape));

// Live Work panel check.
const liveWork = await app.evaluate(() => {
  const lw = document.querySelector('[data-testid="mission-live-work"]');
  return {
    present: !!lw,
    toggle: !!document.querySelector('[data-testid="mission-live-work-toggle"]'),
    text: lw ? lw.textContent.replace(/\s+/g, ' ').slice(0, 200) : null,
  };
});
console.log('LIVEWORK ' + JSON.stringify(liveWork));
await browser.disconnect();
