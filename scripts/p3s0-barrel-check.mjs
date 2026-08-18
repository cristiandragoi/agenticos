// Barrel-import sanity: programmatic humanoid still live through
// `src/components/jarvis-visualization` index.ts named export.
import puppeteer from 'puppeteer-core';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((p) => p.url().includes('file://')) || pages[0];
await app.evaluate(() => { location.hash = '#/jarvis'; });
await sleep(8000);
const r = await app.evaluate(() => {
  const wrap = document.querySelector('[data-testid="jarvis-orb"]');
  if (!wrap) return { error: 'no wrapper' };
  return {
    orbState: wrap.getAttribute('data-orb-state'),
    svgCount: wrap.querySelectorAll('svg').length,
    imgCount: wrap.querySelectorAll('img').length,
    nodes: [...wrap.querySelectorAll('[id^="node-"]')].map((e) => e.id).filter((n) => n !== 'node-glow').sort(),
    face: !!wrap.querySelector('#face-path'),
    brain: !!wrap.querySelector('#brain-glow'),
  };
});
// click Memory node -> route
await app.evaluate(() => {
  const mem = document.querySelector('[data-testid="jarvis-orb"] #node-Memory');
  const svg = document.querySelector('[data-testid="jarvis-orb"] svg');
  if (!mem || !svg) return;
  const b = mem.getBoundingClientRect(); const sb = svg.getBoundingClientRect();
  mem.dispatchEvent(new MouseEvent('click', { clientX: sb.left + b.x, clientY: sb.top + b.y, bubbles: true }));
});
await sleep(1200);
const hash = await app.evaluate(() => window.location.hash);
console.log('RESULT ' + JSON.stringify({ ...r, clickMemoryHash: hash }, null, 1));
await browser.disconnect();
