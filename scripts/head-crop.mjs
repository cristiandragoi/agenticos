// Crop the head canvas region from the screenshot for vision analysis.
import puppeteer from 'puppeteer-core';
import fs from 'fs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((p) => p.url().includes('file://')) || pages[0];
const targets = await browser.targets();
const tgt = targets.find((t) => t.type() === 'page' && t.url().includes('file://'));
const cdp = await tgt.createCDPSession();
await cdp.send('Page.enable');
await app.evaluate(() => { location.hash = '#/jarvis'; });
await sleep(6000);
const shot = await app.screenshot({ path: 'scripts/head-full.png' });
// Crop 180x180 at (520,120) with margin → use CDP to capture just the element.
const el = await app.$('[data-testid="jarvis-orb"]');
const clip = await el.boundingBox();
console.log('CLIP', JSON.stringify(clip));
const cropped = await app.screenshot({
  path: 'scripts/head-crop.png',
  clip: { x: clip.x - 10, y: clip.y - 10, width: clip.width + 20, height: clip.height + 20 },
});
console.log('CROP ok', fs.statSync('scripts/head-crop.png').size);
await browser.disconnect();
