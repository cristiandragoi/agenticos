// ONE verification screenshot: LOCKED CYAN JARVIS (restored approved asset,
// bust crop) + IDLE cognitive field. No thinking, no memory, no nodes.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync('scripts/p3-shots/cognitive-field', { recursive: true });

const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((p) => p.url().includes('file://')) || pages[0];
await app.setViewport({ width: 1600, height: 1000 });
await app.evaluate(() => { location.hash = '#/cog-demo'; });
await sleep(4000);
// startup-race gate: retry (P1 fix reloads registry data too), then re-nav
await app.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => /Retry connection/i.test(x.textContent || ''));
  if (b) b.click();
});
await sleep(6000);
await app.evaluate(() => { location.hash = '#/cog-demo'; });
await sleep(6000);

// do NOT click anything — idle state only
const shot = 'scripts/p3-shots/cognitive-field/locked-cyan-idle.png';
await app.screenshot({ path: shot, fullPage: false });

const info = await app.evaluate(() => {
  const stage = [...document.querySelectorAll('canvas')].find((c) => c.width > 400);
  const overlay = document.querySelectorAll('canvas');
  const imgs = [...document.querySelectorAll('img')];
  const r = stage ? stage.getBoundingClientRect() : null;
  return {
    canvases: overlay.length,
    stageSize: r ? `${Math.round(r.width)}x${Math.round(r.height)}` : null,
    imgSources: imgs.map((i) => (i.src || '').slice(0, 50)),
    imgInsideStage: imgs.some((i) => { const ir = i.getBoundingClientRect(); return stage && ir.left >= r.left && ir.right <= r.right && ir.top >= r.top && ir.bottom <= r.bottom; }),
    modeButtons: [...document.querySelectorAll('button')].map((b) => b.textContent.trim()).slice(0, 12),
  };
});
console.log('SHOT ' + shot);
console.log('INFO ' + JSON.stringify(info, null, 1));
await browser.disconnect();
