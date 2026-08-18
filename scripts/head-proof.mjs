// Reload renderer, verify the humanoid head renders (not the blob), capture
// the canvas + screenshot evidence.
import puppeteer from 'puppeteer-core';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((p) => p.url().includes('file://')) || pages[0];
const targets = await browser.targets();
const tgt = targets.find((t) => t.type() === 'page' && t.url().includes('file://'));
const cdp = await tgt.createCDPSession();
await cdp.send('Page.enable');
await app.evaluate(() => { location.hash = '#/jarvis'; });
await sleep(500);
await cdp.send('Page.reload');
await sleep(12000);
const state = await app.evaluate(() => {
  const canvas = document.querySelector('[data-testid="jarvis-orb"]');
  const label = document.querySelector('[data-testid="jarvis-orb-status-label"]');
  const r = canvas ? canvas.getBoundingClientRect() : null;
  return {
    hasCanvas: !!canvas,
    orbState: canvas?.getAttribute('data-orb-state'),
    label: label ? label.textContent.trim() : null,
    canvasRect: r ? { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), left: Math.round(r.left) } : null,
  };
});
console.log('HEAD_STATE ' + JSON.stringify(state));
await sleep(3000);
const shot = await app.screenshot({ path: 'scripts/head-proof.png' });
console.log('SHOT ' + (shot ? 'ok' : 'failed'));
await browser.disconnect();
