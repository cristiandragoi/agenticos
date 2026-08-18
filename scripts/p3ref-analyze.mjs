// Visionless JPEG reference analysis via Chromium (base64 data URL avoids CORS).
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const b64 = fs.readFileSync('B:/AgenticOS/Humanoid-JARVIS/jarvis-reference.jpeg').toString('base64');
const DATA = `data:image/jpeg;base64,${b64}`;

const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const page = pages.find((p) => p.url().includes('file://')) || pages[0];

const out = await page.evaluate(async (src) => {
  const img = new Image();
  const loaded = new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('img load failed')); });
  img.src = src;
  await Promise.race([loaded, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 15000))]);
  const W = img.naturalWidth, H = img.naturalHeight;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, W, H).data;

  const buckets = new Map();
  for (let i = 0; i < data.length; i += 8) {
    const r = data[i] >> 5 << 5, g = data[i + 1] >> 5 << 5, b = data[i + 2] >> 5 << 5;
    const key = `${r},${g},${b}`;
    buckets.set(key, (buckets.get(key) || 0) + 1);
  }
  const total = data.length / 8;
  const palette = [...buckets.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([k, n]) => ({ rgb: k, pct: +(100 * n / total).toFixed(1) }));

  const NB = 25, bands = [];
  for (let b = 0; b < NB; b++) {
    const y0 = Math.floor(b * H / NB), y1 = Math.floor((b + 1) * H / NB);
    let sum = 0, cnt = 0, cyan = 0;
    for (let y = y0; y < y1; y += 2) {
      for (let x = 0; x < W; x += 2) {
        const i = (y * W + x) * 4;
        const r = data[i], g = data[i + 1], bl = data[i + 2];
        sum += (r + g + bl) / 3; cnt++;
        if (bl > 100 && bl > r + 15) cyan++;
      }
    }
    bands.push({ pct: Math.round(b / NB * 100), lum: Math.round(sum / cnt), cyanPct: +(100 * cyan / cnt).toFixed(1) });
  }

  const grid = [];
  for (let gy = 0; gy < 24; gy++) {
    let row = '';
    for (let gx = 0; gx < 24; gx++) {
      let sum = 0, cnt = 0;
      for (let y = Math.floor(gy * H / 24); y < Math.floor((gy + 1) * H / 24); y += 3) {
        for (let x = Math.floor(gx * W / 24); x < Math.floor((gx + 1) * W / 24); x += 3) {
          const i = (y * W + x) * 4;
          sum += (data[i] + data[i + 1] + data[i + 2]) / 3; cnt++;
        }
      }
      const v = Math.round(sum / cnt / 12.75);
      row += v >= 18 ? '#' : v >= 13 ? 'O' : v >= 8 ? '+' : v >= 4 ? '.' : ' ';
    }
    grid.push(row);
  }
  return { W, H, palette, bands, grid };
}, DATA);

console.log('RESULT ' + JSON.stringify(out, null, 1));
await browser.disconnect();
