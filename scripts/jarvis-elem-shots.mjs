// Element-level screenshots + computed styles for the humanoid regions.
// Captures #chestCore, #lowerEnergyCore, #foreheadCore as separate PNGs so
// clip/viewport math can't confuse the evidence.
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, 'p3-shots', 'reference-match');
mkdirSync(OUT_DIR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((p) => p.url().includes('file://')) || pages[0];
if (!app.url().includes('#/jarvis')) {
  await app.evaluate(() => { location.hash = '#/jarvis'; });
  await sleep(6000);
}

const info = await app.evaluate(() => {
  const svg = document.querySelector('[data-testid="jarvis-orb-stage"] svg');
  const b = (sel) => {
    const el = svg?.querySelector(sel);
    if (!el) return null;
    const r = el.getBBox();
    return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) };
  };
  const circles = (sel) => {
    const el = svg?.querySelector(sel);
    if (!el) return null;
    return Array.from(el.querySelectorAll('circle')).map((c) => ({
      cx: +c.getAttribute('cx'), cy: +c.getAttribute('cy'),
      r: +c.getAttribute('r'), fill: c.getAttribute('fill'), opacity: c.getAttribute('opacity'),
      stroke: c.getAttribute('stroke'),
    })).slice(0, 14);
  };
  return {
    chestBBox: b('#chestCore'),
    lowerBBox: b('#lowerEnergyCore'),
    brainBBox: b('#foreheadCore'),
    chestCircles: circles('#chestCore'),
    lowerCircles: circles('#lowerEnergyCore'),
  };
});
console.log('ELEM ' + JSON.stringify(info));

// element screenshots (captureBeyondViewport handles off-viewport)
const shots = ['#chestCore', '#lowerEnergyCore', '#foreheadCore', '#torso', '#neck'];
for (const sel of shots) {
  const el = await app.$(sel);
  if (!el) { console.log('MISS ' + sel); continue; }
  const safe = sel.replace('#', '');
  await el.screenshot({ path: path.join(OUT_DIR, `elem-${safe}.png`), captureBeyondViewport: true });
  console.log('SHOT ' + safe);
}

// FULL humanoid svg + systems svg (complete figure / module layer)
const fullInfo = await app.evaluate(() => {
  const svgs = Array.from(document.querySelectorAll('svg'));
  const humanoid = svgs.find((s) => s.querySelector('#foreheadCore'));
  const systems = svgs.find((s) => s.querySelector('#jarvis-module-0, g[data-module]')) || svgs[0];
  const b = (el) => { const r = el.getBoundingClientRect(); return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) }; };
  return { humanoidBox: humanoid ? b(humanoid) : null, systemsBox: systems ? b(systems) : null };
});
console.log('FULLBOX ' + JSON.stringify(fullInfo));

const humanoidEl = await app.evaluateHandle(() => {
  const svgs = Array.from(document.querySelectorAll('svg'));
  return svgs.find((s) => s.querySelector('#foreheadCore')) || null;
});
if (humanoidEl) {
  const el = await humanoidEl.asElement();
  await el.screenshot({ path: path.join(OUT_DIR, 'humanoid-full.png'), captureBeyondViewport: true });
  console.log('SHOT humanoid-full');
}
await browser.disconnect();
