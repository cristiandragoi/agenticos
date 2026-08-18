// Color proof v2: sample DOMINANT hue from membrane pixels (alpha 40-140),
// and verify the delegated→idle return with longer waits.
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
await sleep(6000);

const BASE = 'http://127.0.0.1:4600';
const j = async (path, opts) => {
  const res = await fetch(BASE + path, opts);
  let body = null; try { body = await res.json(); } catch {}
  return { status: res.status, body };
};

const sample = () => app.evaluate(() => {
  const canvas = document.querySelector('[data-testid="jarvis-orb"]');
  const label = document.querySelector('[data-testid="jarvis-orb-status-label"]');
  const ctx = canvas.getContext('2d');
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = img.data;
  // Membrane pixels: alpha 40..140 (the translucent head body, not the halo/rim).
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a > 40 && a < 140) { r += data[i]; g += data[i + 1]; b += data[i + 2]; n++; }
  }
  if (n === 0) return { state: canvas?.getAttribute('data-orb-state'), label: label?.textContent.trim(), rgb: null };
  r = Math.round(r / n); g = Math.round(g / n); b = Math.round(b / n);
  // Hue classification.
  let hue = 'other';
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max - min < 30) hue = 'neutral/white';
  else if (r > g && r > b) hue = 'red/pink';
  else if (g >= r && g >= b) hue = 'green';
  else if (b >= r && b >= g) {
    hue = r > 180 && g > 90 && g < 200 ? 'pink' : 'blue/cyan';
  } else if (r > 180 && b > 180 && g < 150) hue = 'purple/pink';
  return { state: canvas?.getAttribute('data-orb-state'), label: label?.textContent.trim(), rgb: [r, g, b], hue };
});

console.log('IDLE ' + JSON.stringify(await sample()));

// Create fresh task → delegated.
const task = await j('/api/background-tasks', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: 'Color proof fresh', objective: 'pink', worker: 'research', dispatch: false }),
});
const taskId = task.body?.taskId;
console.log('TASK', taskId, task.body?.status);
await sleep(5000);
console.log('DELEGATED ' + JSON.stringify(await sample()));

// Cancel and wait longer for poll + color smoothing.
const cancel = await j('/api/background-tasks/' + taskId + '/cancel', { method: 'POST' });
console.log('CANCEL', cancel.status, cancel.body?.status);
await sleep(7000);
console.log('AFTER_CANCEL ' + JSON.stringify(await sample()));
await browser.disconnect();
