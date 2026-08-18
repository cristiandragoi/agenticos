// ORB proof: create an active (queued/running) task, verify JarvisStudio's orb
// reflects 'Delegated…' (pink) via the runtime-state poll, then complete it
// and verify return to idle.
import puppeteer from 'puppeteer-core';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((p) => p.url().includes('file://')) || pages[0];
const targets = await browser.targets();
const tgt = targets.find((t) => t.type() === 'page' && t.url().includes('file://'));
const cdp = await tgt.createCDPSession();
await cdp.send('Page.enable');

const BASE = 'http://127.0.0.1:4600';
const j = async (path, opts) => {
  const res = await fetch(BASE + path, opts);
  let body = null; try { body = await res.json(); } catch {}
  return { status: res.status, body };
};

// Fresh jarvis.
await app.evaluate(() => { location.hash = '#/jarvis'; });
await sleep(6000);

const readOrb = () => app.evaluate(() => {
  const label = document.querySelector('[data-testid="jarvis-orb-status-label"]');
  const strip = document.querySelector('[data-testid="jarvis-status-strip"]');
  return {
    label: label ? label.textContent.trim() : null,
    strip: strip ? strip.textContent.replace(/\s+/g, ' ').slice(0, 120) : null,
  };
});

const before = await readOrb();
console.log('ORB_BEFORE ' + JSON.stringify(before));

// Create an active task (dispatch:false keeps it queued/running → delegated).
const task = await j('/api/background-tasks', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: 'Orb delegated proof', objective: 'prove pink', worker: 'research', dispatch: false }),
});
console.log('TASK ' + task.body?.taskId + ' status=' + task.body?.status);

// Wait for the 3s runtime-state poll to pick it up.
let orbDuring = null;
for (let i = 0; i < 8; i++) {
  await sleep(1200);
  const s = await readOrb();
  if (s.label && /Delegat/i.test(s.label)) { orbDuring = s; break; }
  if (i === 7) orbDuring = s;
}
console.log('ORB_DURING ' + JSON.stringify(orbDuring));

// Cancel the task → back to idle.
await j('/api/background-tasks/' + task.body?.taskId + '/cancel', { method: 'POST' });
let orbAfter = null;
for (let i = 0; i < 6; i++) {
  await sleep(1200);
  const s = await readOrb();
  if (s.label && /Idle/i.test(s.label)) { orbAfter = s; break; }
  if (i === 5) orbAfter = s;
}
console.log('ORB_AFTER ' + JSON.stringify(orbAfter));
await browser.disconnect();
