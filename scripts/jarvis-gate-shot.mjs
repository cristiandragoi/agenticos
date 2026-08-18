// One-shot packaged-app JARVIS gate shot + structural read over CDP.
// Navigates to #/jarvis, reads backend chip / orb state / module labels /
// activity rows, then captures the stage clip + full page to
// scripts/p3-shots/reference-match/. Pixel analysis is done separately
// (visionless evidence for the human gate).
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

const read = () =>
  app.evaluate(() => {
    const dot = document.querySelector('[data-testid="backend-status-dot"]');
    const chip = dot ? dot.closest('button') : null;
    const orb = document.querySelector('[data-testid="jarvis-orb"]');
    const stage = document.querySelector('[data-testid="jarvis-orb-stage"]');
    const labels = Array.from(document.querySelectorAll('[data-testid="jarvis-orb"] text'))
      .map((t) => (t.textContent || '').trim())
      .filter((t) => /^(MEMORY|VISION|KNOWLEDGE|PROJECTS|HERMES|ARTIFACTS|RUNS)$/.test(t));
    const stream = document.querySelector('[data-testid="jarvis-activity-stream"]');
    return {
      url: location.href,
      backendChip: chip ? chip.innerText.replace(/\s+/g, ' ').trim() : null,
      orbPresent: !!orb,
      orbState: orb ? orb.getAttribute('data-orb-state') : null,
      stagePresent: !!stage,
      moduleLabels: labels,
      activityRows: stream ? stream.children.length : 0,
      activityText: stream ? stream.innerText.slice(0, 220) : null,
      bodySnippet: document.body.innerText.slice(0, 300).replace(/\n+/g, ' | '),
    };
  });

let info = await read();
// Always land on the real Jarvis stage — MissionControl's V1 JarvisCore also
// carries a jarvis-orb testid, so presence alone must not skip navigation.
if (!info.url.includes('#/jarvis')) {
  await app.evaluate(() => { location.hash = '#/jarvis'; });
  await sleep(8000);
  info = await read();
}
if (!info.orbPresent || info.url.includes('mission-control')) {
  await app.evaluate(() => { location.hash = '#/jarvis'; });
  await sleep(8000);
  info = await read();
}

// stage clip at 2x for crisp SVG detail
const box = await app.evaluate(() => {
  const el = document.querySelector('[data-testid="jarvis-orb"]');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
});

const clipPath = path.join(OUT_DIR, 'jarvis-stage.png');
const fullPath = path.join(OUT_DIR, 'jarvis-full.png');
if (box) {
  await app.screenshot({ path: clipPath, clip: { x: box.x, y: box.y, width: box.width, height: box.height }, captureBeyondViewport: true });
}
await app.screenshot({ path: fullPath, captureBeyondViewport: true });

console.log('JARVIS_GATE ' + JSON.stringify({ ...info, stageBox: box, clipPath, fullPath }));
await browser.disconnect();
