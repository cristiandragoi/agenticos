// v2 extraction: stricter figure mask + median filter; density-cell feature
// detection; debug ASCII grid of the cleaned mask.
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

  const MW = Math.floor(W / 2), MH = Math.floor(H / 2);
  const rawMask = new Uint8Array(MW * MH);
  const feats = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x += 2) {
      const i = (y * W + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const lum = (r + g + b) / 3;
      // figure: real teal/cyan (saturated) OR bright core
      const teal = b >= g && g >= r && b > 40 && g > 14 && b > r + 14;
      const brightCore = lum > 70;
      if (teal || brightCore) {
        rawMask[(y >> 1) * MW + (x >> 1)] = 1;
        if (lum > 40) feats.push({ x, y, lum, r, g, b });
      }
    }
  }
  // median filter 3x3 (keep if >=3 of 9 neighbors)
  const mask = new Uint8Array(MW * MH);
  for (let y = 1; y < MH - 1; y++) {
    for (let x = 1; x < MW - 1; x++) {
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) n += rawMask[(y + dy) * MW + (x + dx)];
      if (n >= 3) mask[y * MW + x] = 1;
    }
  }
  // debug grid 68x85 (1/4 of MW/MH)
  const GW = 68, GH = 85;
  const grid = [];
  for (let gy = 0; gy < GH; gy++) {
    let row = '';
    for (let gx = 0; gx < GW; gx++) {
      let n = 0, tot = 0;
      for (let y = Math.floor(gy * MH / GH); y < Math.floor((gy + 1) * MH / GH); y++) {
        for (let x = Math.floor(gx * MW / GW); x < Math.floor((gx + 1) * MW / GW); x++) {
          n += mask[y * MW + x]; tot++;
        }
      }
      const v = n / tot;
      row += v > 0.3 ? '#' : v > 0.12 ? 'O' : v > 0.04 ? '+' : v > 0.01 ? '.' : ' ';
    }
    grid.push(row);
  }
  return { W, H, MW, MH, mask: Array.from(mask), feats, grid };
}, DATA);

fs.writeFileSync('scripts/p3-vector-raw2.json', JSON.stringify(out));
console.log('RAW2 OK mask ' + out.MW + 'x' + out.MH + ' feats ' + out.feats.length);
console.log(out.grid.join('\n'));
await browser.disconnect();
