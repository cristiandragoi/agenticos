// Packaged-app Visual Universe gate: navigate /jarvis, verify the NEW bundle,
// read the universe canvas, analyze locked-palette pixels, capture screenshots.
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, 'p3-shots', 'visual-universe');
mkdirSync(OUT_DIR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((p) => p.url().includes('file://')) || pages[0];

// ── Bundle identity: confirm the NEW asset is what the window loaded. ──
const bundle = await app.evaluate(() => ({
  url: location.href,
  scripts: [...document.querySelectorAll('script[src]')].map((s) => s.getAttribute('src')),
  perfAssets: (performance.getEntriesByType('resource') || [])
    .map((e) => e.name.split('/').pop()).filter((n) => n && n.includes('index-')),
}));

if (!bundle.url.includes('#/jarvis')) {
  await app.evaluate(() => { location.hash = '#/jarvis'; });
  await sleep(9000);
}

const read = () =>
  app.evaluate(() => {
    const dot = document.querySelector('[data-testid="backend-status-dot"]');
    const chip = dot ? dot.closest('button') : null;
    const orb = document.querySelector('[data-testid="jarvis-orb"]');
    const canvas = document.querySelector('[data-testid="jarvis-orb-canvas"]');
    const label = document.querySelector('[data-testid="jarvis-orb-model"]');
    const humanoidStage = document.querySelector('[data-testid="jarvis-orb-stage"]');
    return {
      url: location.href,
      backendChip: chip ? chip.innerText.replace(/\s+/g, ' ').trim() : null,
      orbPresent: !!orb,
      orbCanvasPresent: !!canvas,
      canvasSize: canvas ? `${canvas.width}x${canvas.height}` : null,
      modelLabel: label ? label.textContent : null,
      humanoidStageAbsent: !humanoidStage,
    };
  });

let info = await read();
if (!info.url.includes('#/jarvis')) {
  await app.evaluate(() => { location.hash = '#/jarvis'; });
  await sleep(9000);
  info = await read();
}

// ── Canvas pixel analysis: locked-palette presence + red-absence. ──
// Palette (locked): turquoise #14B8A6, yellow #FACC15, orange #F97316,
// pink #EC4899, purple #A855F7, red #EF4444 (failure ONLY).
const palette = {
  turquoise: [20, 184, 166],
  yellow: [250, 204, 21],
  orange: [249, 115, 22],
  pink: [236, 72, 153],
  purple: [168, 85, 247],
  red: [239, 68, 68],
};
const pixels = await app.evaluate(() => {
  const canvas = document.querySelector('[data-testid="jarvis-orb-canvas"]');
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  return { width, height, data: Array.from(data) };
});

function analyzePixels(pix) {
  if (!pix) return null;
  const counts = { turquoise: 0, yellow: 0, orange: 0, pink: 0, purple: 0, red: 0, dark: 0, other: 0 };
  let lit = 0;
  const step = 4; // sample every 4th pixel for speed
  for (let i = 0; i < pix.data.length; i += 4 * step) {
    const r = pix.data[i], g = pix.data[i + 1], b = pix.data[i + 2], a = pix.data[i + 3];
    if (a < 40) continue;
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (lum < 25) { counts.dark++; continue; }
    lit++;
    let best = 'other', bestD = Infinity;
    for (const [name, [pr, pg, pb]] of Object.entries(palette)) {
      const d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
      if (d < bestD) { bestD = d; best = name; }
    }
    counts[best]++;
  }
  const total = counts.turquoise + counts.yellow + counts.orange + counts.pink + counts.purple + counts.red + counts.dark + counts.other;
  const pct = (n) => total ? ((n / total) * 100).toFixed(2) + '%' : '0%';
  return {
    width: pix.width, height: pix.height,
    sampled: Math.floor(pix.data.length / 4 / step),
    lit: Math.floor(lit / step) * step,
    distribution: Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, v * step])),
    pct: Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, pct(v * step)])),
    redAbsent: counts.red === 0,
  };
}
const paletteReport = analyzePixels(pixels);

// ── Projects API truth (canonical persisted projects the universe shows). ──
const projRes = await fetch('http://127.0.0.1:4000/api/projects');
const projData = await projRes.json();
const projNames = (projData.projects || []).map((p) => p.name);

// ── Screenshots ──
const box = await app.evaluate(() => {
  const el = document.querySelector('[data-testid="jarvis-orb"]');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
});
const orbPath = path.join(OUT_DIR, 'jarvis-universe-orb.png');
const fullPath = path.join(OUT_DIR, 'jarvis-universe-full.png');
if (box) {
  await app.screenshot({ path: orbPath, clip: { x: box.x, y: box.y, width: box.width, height: box.height }, captureBeyondViewport: true });
}
await app.screenshot({ path: fullPath, captureBeyondViewport: true });

const result = { bundle, info, paletteReport, projectCount: projNames.length, projectNames: projNames, orbPath, fullPath };
writeFileSync(path.join(OUT_DIR, 'gate.json'), JSON.stringify(result, null, 2));
console.log('VISUAL_UNIVERSE_GATE ' + JSON.stringify(result));
await browser.disconnect();
