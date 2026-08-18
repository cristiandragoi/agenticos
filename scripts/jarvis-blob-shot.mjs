// One-shot packaged-app JARVIS BLOB gate shot + structural read over CDP.
// After the humanoid rollback: asserts the neural blob (canvas) is the
// central visualization, no humanoid stage remains, backend connected.
// Screenshots the orb clip + full page to scripts/p3-shots/neural-core/.
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, 'p3-shots', 'neural-core');
mkdirSync(OUT_DIR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((p) => p.url().includes('file://')) || pages[0];

const read = () =>
  app.evaluate(() => {
    const dot = document.querySelector('[data-testid="backend-status-dot"]');
    const chip = dot ? dot.closest('button') : null;
    const orb = document.querySelector('[data-testid="jarvis-orb"]');
    const canvas = document.querySelector('[data-testid="jarvis-orb-canvas"]');
    const humanoidStage = document.querySelector('[data-testid="jarvis-orb-stage"]');
    const stream = document.querySelector('[data-testid="jarvis-activity-stream"]');
    return {
      url: location.href,
      backendChip: chip ? chip.innerText.replace(/\s+/g, ' ').trim() : null,
      orbPresent: !!orb,
      orbCanvasPresent: !!canvas,
      canvasSize: canvas ? `${canvas.width}x${canvas.height}` : null,
      humanoidStageAbsent: !humanoidStage,
      activityRows: stream ? stream.children.length : 0,
      activityText: stream ? stream.innerText.slice(0, 160) : null,
    };
  });

let info = await read();
if (!info.url.includes('#/jarvis')) {
  await app.evaluate(() => { location.hash = '#/jarvis'; });
  await sleep(8000);
  info = await read();
}

const box = await app.evaluate(() => {
  const el = document.querySelector('[data-testid="jarvis-orb"]');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
});

const orbPath = path.join(OUT_DIR, 'jarvis-orb.png');
const fullPath = path.join(OUT_DIR, 'jarvis-full.png');
if (box) {
  await app.screenshot({ path: orbPath, clip: { x: box.x, y: box.y, width: box.width, height: box.height }, captureBeyondViewport: true });
}
await app.screenshot({ path: fullPath, captureBeyondViewport: true });

console.log('JARVIS_BLOB_GATE ' + JSON.stringify({ ...info, orbBox: box, orbPath, fullPath }));
await browser.disconnect();
