// Phase 3 Slice 1 verification — neural-universe nodes render, are clickable,
// and route to real destinations. Visionless: pixel + DOM + hash evidence.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NODES = [
  { id: 'memory',    x: 0.125, y: 0.14 },
  { id: 'projects',  x: 0.875, y: 0.14 },
  { id: 'knowledge', x: 0.05,  y: 0.44 },
  { id: 'hermes',    x: 0.95,  y: 0.44 },
  { id: 'runs',      x: 0.125, y: 0.74 },
  { id: 'artifacts', x: 0.875, y: 0.74 },
  { id: 'vision',    x: 0.50,  y: 0.94 },
];

const results = {};
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((p) => p.url().includes('file://')) || pages[0];
await app.evaluate(() => { location.hash = '#/jarvis'; });
await sleep(7000);

// 1. Canvas + node pixels.
const pixel = await app.evaluate(async (nodeList) => {
  const canvas = document.querySelector('[data-testid="jarvis-orb"]');
  if (!canvas) return { error: 'canvas not found' };
  const rect = canvas.getBoundingClientRect();
  const S = rect.width;
  const ctx = canvas.getContext('2d');
  // getImageData coordinates are BACKING pixels; scale CSS rect by dpr.
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const out = { canvasSize: S, backing: [canvas.width, canvas.height], rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height }, nodes: {} };
  for (const n of nodeList) {
    const px = Math.round(n.x * rect.width * scaleX);
    const py = Math.round(n.y * rect.height * scaleY);
    const half = Math.round(10 * scaleX);
    const box = ctx.getImageData(px - half, py - half, half * 2, half * 2).data;
    let r = 0, g = 0, b = 0, a = 0, lit = 0;
    for (let i = 0; i < box.length; i += 4) {
      r += box[i]; g += box[i + 1]; b += box[i + 2]; a += box[i + 3];
      if (box[i + 3] > 12 && (box[i] + box[i + 1] + box[i + 2]) / 3 > 30) lit++;
    }
    const npx = box.length / 4;
    out.nodes[n.id] = {
      mean: [Math.round(r / npx), Math.round(g / npx), Math.round(b / npx)],
      meanAlpha: Math.round(a / npx),
      litPixels: lit,
      drawn: lit > 4,
    };
  }
  return out;
}, NODES);
results.pixels = pixel;

// 2. Click routing: click the Memory node -> hash must become #/memory.
const click = await app.evaluate((nodeList) => {
  const canvas = document.querySelector('[data-testid="jarvis-orb"]');
  const rect = canvas.getBoundingClientRect();
  const n = nodeList[0]; // memory
  canvas.dispatchEvent(new MouseEvent('click', {
    clientX: rect.left + n.x * rect.width,
    clientY: rect.top + n.y * rect.height,
    bubbles: true,
  }));
  return true;
}, NODES);
await sleep(1200);
results.clickMemoryHash = await app.evaluate(() => window.location.hash);

// Back to jarvis, then screenshot (full page + orb crop).
await app.evaluate(() => { location.hash = '#/jarvis'; });
await sleep(4000);
const shotDir = 'scripts/p3-shots';
fs.mkdirSync(shotDir, { recursive: true });
const fullPath = `${shotDir}/jarvis-hero-full.png`;
await app.screenshot({ path: fullPath, fullPage: false });
const orbShot = await app.$('[data-testid="jarvis-orb-wrapper"]');
const orbPath = orbShot ? `${shotDir}/jarvis-orb-crop.png` : null;
if (orbShot) await orbShot.screenshot({ path: orbPath });
results.screenshots = { full: fullPath, orb: orbPath };

// 3. Console errors.
const errors = [];
app.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); });
app.on('pageerror', (e) => errors.push('PAGEERROR:' + String(e).slice(0, 160)));
await sleep(3000);
results.consoleErrors = errors.slice(-6);

console.log('RESULT ' + JSON.stringify(results, null, 1));
await browser.disconnect();
