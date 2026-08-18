// Verify the humanoid head color responds to REAL runtime state by creating
// real backend states and sampling the canvas dominant color.
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
  // Average color of the brightest 2% of pixels (the head/rim, not the halo).
  const samples = [];
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a > 120) {
      const lum = (data[i] + data[i + 1] + data[i + 2]) / 3;
      samples.push({ r: data[i], g: data[i + 1], b: data[i + 2], lum });
    }
  }
  samples.sort((a, b) => b.lum - a.lum);
  const top = samples.slice(0, Math.max(1, Math.floor(samples.length * 0.2)));
  const avg = top.reduce((acc, s) => ({ r: acc.r + s.r, g: acc.g + s.g, b: acc.b + s.b }), { r: 0, g: 0, b: 0 });
  const n = Math.max(1, top.length);
  const [r, g, b] = [Math.round(avg.r / n), Math.round(avg.g / n), Math.round(avg.b / n)];
  return { state: canvas?.getAttribute('data-orb-state'), label: label?.textContent.trim(), rgb: [r, g, b], hex: '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('') };
});

// 1. Idle baseline.
console.log('IDLE ' + JSON.stringify(await sample()));

// 2. Create a fresh task → delegated (pink).
const task = await j('/api/background-tasks', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: 'Delegated color proof', objective: 'prove pink head', worker: 'research', dispatch: false }),
});
await sleep(4000);
console.log('DELEGATED ' + JSON.stringify(await sample()));

// 3. Cancel → idle again.
await j('/api/background-tasks/' + task.body?.taskId + '/cancel', { method: 'POST' });
await sleep(4000);
console.log('AFTER_CANCEL ' + JSON.stringify(await sample()));
await browser.disconnect();
