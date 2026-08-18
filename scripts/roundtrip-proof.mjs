// Full round-trip: idle → delegated (pink) → cancel → idle (cyan), sampling
// dominant membrane color each step.
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
await sleep(8000);

const BASE = 'http://127.0.0.1:4600';
const j = async (path, opts) => {
  const res = await fetch(BASE + path, opts);
  let body = null; try { body = await res.json(); } catch {}
  return { status: res.status, body };
};
const sample = () => app.evaluate(() => {
  const canvas = document.querySelector('[data-testid="jarvis-orb"]');
  const ctx = canvas.getContext('2d');
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = img.data;
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a > 40 && a < 140) { r += data[i]; g += data[i + 1]; b += data[i + 2]; n++; }
  }
  if (!n) return { state: canvas?.getAttribute('data-orb-state'), rgb: null };
  r = Math.round(r / n); g = Math.round(g / n); b = Math.round(b / n);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let hue = 'other';
  if (max - min < 30) hue = 'neutral';
  else if (r > g && r > b && g < 130) hue = 'pink/red';
  else if (b > r && g > r) hue = 'cyan/blue';
  else if (g >= r && g >= b) hue = 'green';
  else if (r > 150 && b > 120 && g < 120) hue = 'purple/pink';
  else hue = 'mixed';
  return { state: canvas?.getAttribute('data-orb-state'), rgb: [r, g, b], hue };
});

console.log('IDLE ' + JSON.stringify(await sample()));
const task = await j('/api/background-tasks', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: 'Round trip pink', objective: 'pink', worker: 'research', dispatch: false }),
});
let del = null;
for (let i = 0; i < 8; i++) { await sleep(1500); del = await sample(); if (del?.state === 'delegated') break; }
console.log('DELEGATED ' + JSON.stringify(del));
await j('/api/background-tasks/' + task.body?.taskId + '/cancel', { method: 'POST' });
let after = null;
for (let i = 0; i < 10; i++) { await sleep(1500); after = await sample(); if (after?.state === 'idle') break; }
console.log('AFTER_CANCEL ' + JSON.stringify(after));
await browser.disconnect();
