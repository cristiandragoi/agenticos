// Phase 16 UI gate: real nav click -> /jarvis, inspect WebGL2/orb/testids, screenshot.
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, 'p16-shots');
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((p) => p.url().includes('file://')) || pages[0];

const before = await app.evaluate(() => ({ url: location.href, title: document.title }));
console.log('BEFORE_URL', JSON.stringify(before));

// REAL navigation click (no location.hash assignment)
await app.waitForSelector('[data-testid="nav-jarvis"]', { timeout: 8000 });
const navInfo = await app.evaluate(() => {
  const el = document.querySelector('[data-testid="nav-jarvis"]');
  return { tag: el.tagName, href: el.getAttribute('href'), text: el.textContent.trim(), visible: el.offsetParent !== null };
});
console.log('NAV_JARVIS', JSON.stringify(navInfo));
await app.click('[data-testid="nav-jarvis"]');
await sleep(3000);

const after = await app.evaluate(() => {
  const route = location.href;
  const canvases = [...document.querySelectorAll('canvas')].map((c) => {
    let webgl2 = false, webgl = false;
    try { webgl2 = !!c.getContext('webgl2'); } catch {}
    try { webgl = !!c.getContext('webgl'); } catch {}
    return { testid: c.getAttribute('data-testid'), w: c.width, h: c.height, webgl2, webgl };
  });
  const has = (sel) => !!document.querySelector(sel);
  const model = document.querySelector('[data-testid="jarvis-neural-model"]');
  const orbRegion = document.querySelector('[data-testid="jarvis-orb-region"]');
  const orbLabel = document.querySelector('[data-testid="jarvis-orb-label"]');
  const statusLabel = document.querySelector('[data-testid="jarvis-orb-status-label"]');
  // all data-testids present in the jarvis page
  const testids = [...document.querySelectorAll('[data-testid]')].map((e) => e.getAttribute('data-testid'));
  return {
    route,
    canvases,
    hasJarvisOrb: has('[data-testid="jarvis-orb"]'),
    hasNeuralCanvas: has('[data-testid="jarvis-neural-canvas"]'),
    hasOrbCanvas: has('[data-testid="jarvis-orb-canvas"]'),
    modelLabel: model ? model.textContent.trim() : null,
    orbRegionPresent: !!orbRegion,
    orbLabelText: orbLabel ? orbLabel.textContent.trim() : null,
    statusLabelText: statusLabel ? statusLabel.textContent.trim() : null,
    testids,
    bodyTextLen: document.body.innerText.length,
  };
});
console.log('AFTER_NAV', JSON.stringify(after, null, 2));

// Screenshots
const fullPath = path.join(OUT, 'jarvis-full.png');
await app.screenshot({ path: fullPath, captureBeyondViewport: true });
let orbBox = await app.evaluate(() => {
  const el = document.querySelector('[data-testid="jarvis-orb-region"]') || document.querySelector('[data-testid="jarvis-neural-canvas"]') || document.querySelector('[data-testid="jarvis-orb"]');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
});
let orbPath = null;
if (orbBox) {
  orbPath = path.join(OUT, 'jarvis-orb.png');
  await app.screenshot({ path: orbPath, clip: { x: orbBox.x, y: orbBox.y, width: orbBox.width, height: orbBox.height }, captureBeyondViewport: true });
}
console.log('SCREENSHOTS', JSON.stringify({ fullPath, orbPath, orbBox }));
writeFileSync(path.join(OUT, 'gate.json'), JSON.stringify({ before, navInfo, after, fullPath, orbPath }, null, 2));
await browser.disconnect();
