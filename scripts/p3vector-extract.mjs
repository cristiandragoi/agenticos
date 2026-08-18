// Extract the reference's geometry: figure mask (downsampled), silhouette
// profiles, feature clusters — the SOURCE for the vectorized SVG.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const b64 = fs.readFileSync('B:/AgenticOS/Humanoid-JARVIS/jarvis-reference.jpeg').toString('base64');
const DATA = `data:image/jpeg;base64,${b64}`;

const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const page = pages.find((p) => p.url().includes('file://')) || pages[0];

const out = await page.evaluate(async (src) => {
  const img = new Image();
  const loaded = new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('load')); });
  img.src = src;
  await Promise.race([loaded, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 15000))]);
  const W = img.naturalWidth, H = img.naturalHeight;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, W, H).data;

  // figure mask at half resolution
  const MW = Math.floor(W / 2), MH = Math.floor(H / 2);
  const mask = new Uint8Array(MW * MH);
  // bright feature candidates (full res)
  const feats = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x += 2) {
      const i = (y * W + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const lum = (r + g + b) / 3;
      // figure = teal/cyan family or bright (white cores)
      const cyan = b >= g && g >= r && (b + g) / 2 > 22;
      const bright = lum > 60;
      const isFig = cyan || bright;
      if (isFig) {
        const mx = x >> 1, my = y >> 1;
        mask[my * MW + mx] = 1;
        if (lum > 45) feats.push({ x, y, lum, r, g, b });
      }
    }
  }
  // row/col profiles of the mask
  const rows = [], cols = [];
  for (let my = 0; my < MH; my++) { let n = 0; for (let mx = 0; mx < MW; mx++) n += mask[my * MW + mx]; rows.push(n); }
  for (let mx = 0; mx < MW; mx++) { let n = 0; for (let my = 0; my < MH; my++) n += mask[my * MW + mx]; cols.push(n); }
  return { W, H, MW, MH, mask: Array.from(mask), rows, cols, feats: feats.slice(0, 8000) };
}, DATA);

fs.writeFileSync('scripts/p3-vector-raw.json', JSON.stringify(out));
console.log('RAW OK: ' + out.W + 'x' + out.H + ' mask ' + out.MW + 'x' + out.MH + ' feats ' + out.feats.length);
await browser.disconnect();
