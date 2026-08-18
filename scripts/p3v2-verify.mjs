// v2 live acceptance — single central humanoid, no raster, independent
// regions, nodes route to real destinations.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = {};

const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((p) => p.url().includes('file://')) || pages[0];
await app.evaluate(() => { location.hash = '#/jarvis'; });
await sleep(8000);

// 1. DOM: no raster, single humanoid, regions, nodes.
const dom = await app.evaluate(() => {
  const wrap = document.querySelector('[data-testid="jarvis-orb"]');
  if (!wrap) return { error: 'no wrapper' };
  const humanoids = wrap.querySelectorAll('.jhv-humanoid').length;
  const nodes = [...wrap.querySelectorAll('.jhv-node')].map((n) => n.getAttribute('aria-label'));
  return {
    orbState: wrap.getAttribute('data-orb-state'),
    imgCount: wrap.querySelectorAll('img').length,
    svgCount: wrap.querySelectorAll('svg').length,
    humanoidCount: humanoids,           // MUST be exactly 1 — no preview duplicates
    regions: {
      eyes: !!wrap.querySelector('.jhv-eyes'),
      brain: !!wrap.querySelector('.jhv-brain'),
      chest: !!wrap.querySelector('.jhv-chest'),
      shell: !!wrap.querySelector('.jhv-shell'),
      mouth: !!wrap.querySelector('.jhv-face path:last-of-type') !== null,
    },
    nodes: nodes.sort(),
    hasOracle: nodes.includes('ORACLE'),
  };
});
results.dom = dom;

// 2. Region independence: read opacities (per-frame, real).
const readRegions = () => app.evaluate(() => {
  const wrap = document.querySelector('[data-testid="jarvis-orb"]');
  const gs = (sel) => {
    const el = wrap.querySelector(sel);
    return el ? el.style.opacity || getComputedStyle(el).opacity : null;
  };
  const mouth = wrap.querySelector('.jhv-face path:last-of-type');
  return {
    eyes: gs('.jhv-eyes'),
    brain: gs('.jhv-brain'),
    chest: gs('.jhv-chest'),
    mouthD: mouth ? mouth.getAttribute('d') : null,
    orbState: wrap.getAttribute('data-orb-state'),
  };
});
results.idleRegions = await readRegions();

// 3. Real typed turn → capture during THINKING + after completion.
await app.evaluate(() => {
  const ta = document.querySelector('[data-testid="jarvis-composer-textarea"], textarea');
  if (!ta) return;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
  if (setter) setter.call(ta, 'Reply with exactly: V2_OK');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
});
await sleep(300);
await app.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => /send/i.test(b.textContent || ''));
  if (btn) btn.click();
});
let thinking = null;
for (let i = 0; i < 8; i++) {
  await sleep(3000);
  thinking = await readRegions();
  if (thinking.orbState && thinking.orbState !== 'idle') break;
}
results.thinkingRegions = thinking;
await sleep(18000);
results.completedRegions = await readRegions();

// 4. Node click route: click Memory node.
await app.evaluate(() => {
  const mem = [...document.querySelectorAll('.jhv-node')].find((n) => n.getAttribute('aria-label') === 'MEMORY');
  if (mem) mem.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
});
await sleep(1200);
results.clickMemoryHash = await app.evaluate(() => window.location.hash);

// 5. Screenshots.
await app.evaluate(() => { location.hash = '#/jarvis'; });
await sleep(5000);
fs.mkdirSync('scripts/p3-shots', { recursive: true });
await app.screenshot({ path: 'scripts/p3-shots/v2-idle-full.png', fullPage: false });
const orbEl = await app.$('[data-testid="jarvis-orb"]');
if (orbEl) await orbEl.screenshot({ path: 'scripts/p3-shots/v2-orb-crop.png' });
results.screenshots = ['scripts/p3-shots/v2-idle-full.png', 'scripts/p3-shots/v2-orb-crop.png'];

const errors = [];
app.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 140)); });
app.on('pageerror', (e) => errors.push('PAGEERROR:' + String(e).slice(0, 140)));
await sleep(2500);
results.consoleErrors = errors.slice(-6);

console.log('RESULT ' + JSON.stringify(results, null, 1));
await browser.disconnect();
