// Slice 0 acceptance — programmatic humanoid live verification.
// Proves: no raster in the central humanoid, SVG regions render + respond
// independently, neural nodes click through to real routes, real states flow.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = 'http://localhost:4000';
const results = {};

const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((p) => p.url().includes('file://')) || pages[0];
await app.evaluate(() => { location.hash = '#/jarvis'; });
await sleep(8000);

// 1. NO-RASTER + SVG DOM proof.
const dom = await app.evaluate(() => {
  const wrap = document.querySelector('[data-testid="jarvis-orb"]');
  if (!wrap) return { error: 'no jarvis-orb wrapper' };
  const svg = wrap.querySelector('svg');
  const imgs = wrap.querySelectorAll('img');
  const nodes = [...wrap.querySelectorAll('[id^="node-"]')].map((el) => el.id);
  const regions = {
    face: !!wrap.querySelector('#face-path'),
    eyes: !!wrap.querySelector('#eye-left') && !!wrap.querySelector('#eye-right'),
    brain: !!wrap.querySelector('#brain-glow'),
    chest: !!wrap.querySelector('#chest-glow'),
    halo: !!wrap.querySelector('#halo-ring'),
  };
  return {
    hasSvg: !!svg,
    svgCount: wrap.querySelectorAll('svg').length,
    canvasCount: wrap.querySelectorAll('canvas').length, // particle layer only
    imgCount: imgs.length,
    nodeIds: nodes.sort(),
    hasOracle: nodes.some((n) => n === 'node-Oracle'),
    regions,
    orbState: wrap.getAttribute('data-orb-state'),
  };
});
results.dom = dom;

// 2. Region attribute values (prove independent control, not fake).
const readRegions = () => app.evaluate(() => {
  const q = (s) => document.querySelector(`[data-testid="jarvis-orb"] ${s}`);
  return {
    brainStd: q('#brain-blur')?.getAttribute('stdDeviation') || null,
    chestStd: q('#chest-blur')?.getAttribute('stdDeviation') || null,
    faceWidth: q('#face-path')?.getAttribute('stroke-width') || null,
    eyeR: q('#eye-left')?.getAttribute('r') || null,
    haloW: q('#halo-ring')?.getAttribute('stroke-width') || null,
    orbState: document.querySelector('[data-testid="jarvis-orb"]')?.getAttribute('data-orb-state'),
  };
});

results.idleRegions = await readRegions();

// 3. Real typed turn → capture region attrs during THINKING and after COMPLETED.
await app.evaluate(() => {
  const ta = document.querySelector('[data-testid="jarvis-composer-textarea"], textarea');
  if (!ta) return;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
  if (setter) setter.call(ta, 'Reply with exactly: PROGRAMMATIC_OK');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
});
await sleep(300);
await app.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => /send/i.test(b.textContent || ''));
  if (btn) btn.click();
});

// Sample during WAITING (thinking) — poll up to ~25s for a non-idle state.
let thinking = null;
for (let i = 0; i < 8; i++) {
  await sleep(3000);
  thinking = await readRegions();
  if (thinking.orbState && thinking.orbState !== 'idle') break;
}
results.thinkingRegions = thinking;

// After completion.
await sleep(20000);
results.completedRegions = await readRegions();

// 4. Node click route proof: click Memory node (first visible node).
const click = await app.evaluate(() => {
  const wrap = document.querySelector('[data-testid="jarvis-orb"]');
  const svg = wrap.querySelector('svg');
  const mem = wrap.querySelector('#node-Memory');
  if (!mem) return { ok: false, why: 'no node-Memory' };
  const box = mem.getBoundingClientRect();
  const svgBox = svg.getBoundingClientRect();
  const evt = new MouseEvent('click', { clientX: svgBox.left + box.x, clientY: svgBox.top + box.y, bubbles: true });
  mem.dispatchEvent(evt);
  return { ok: true };
});
await sleep(1200);
results.clickMemoryHash = await app.evaluate(() => window.location.hash);

// Back to jarvis + screenshots.
await app.evaluate(() => { location.hash = '#/jarvis'; });
await sleep(5000);
fs.mkdirSync('scripts/p3-shots', { recursive: true });
await app.screenshot({ path: 'scripts/p3-shots/programmatic-idle-full.png', fullPage: false });
const orbEl = await app.$('[data-testid="jarvis-orb"]');
if (orbEl) await orbEl.screenshot({ path: 'scripts/p3-shots/programmatic-orb-crop.png' });
results.screenshots = ['scripts/p3-shots/programmatic-idle-full.png', 'scripts/p3-shots/programmatic-orb-crop.png'];

const errors = [];
app.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 140)); });
app.on('pageerror', (e) => errors.push('PAGEERROR:' + String(e).slice(0, 140)));
await sleep(2500);
results.consoleErrors = errors.slice(-6);

console.log('RESULT ' + JSON.stringify(results, null, 1));
await browser.disconnect();
