// Live Work on Jarvis page: reload, create a real task, verify events appear.
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

const BASE = 'http://127.0.0.1:4600';
const j = async (path, opts) => {
  const res = await fetch(BASE + path, opts);
  let body = null; try { body = await res.json(); } catch {}
  return { status: res.status, body };
};

// Expand Live Work and check it's present.
const lw = await app.evaluate(() => {
  const panel = document.querySelector('[data-testid="jarvis-live-work"]');
  const toggle = document.querySelector('[data-testid="jarvis-live-work-toggle"]');
  if (toggle) toggle.click();
  return { present: !!panel, hasToggle: !!toggle };
});
console.log('LIVEWORK ' + JSON.stringify(lw));
await sleep(500);

// Create a real task (dispatch false → stays queued, generates events).
const task = await j('/api/background-tasks', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: 'TEST Live Work event proof', objective: 'show events', worker: 'research', dispatch: false }),
});
console.log('TASK', task.body?.taskId, task.body?.status);
await sleep(4000);

const body = await app.evaluate(() => {
  const events = document.querySelector('[data-testid="jarvis-live-work-events"]');
  const kv = document.querySelector('[data-testid="jarvis-live-work-body"]');
  return {
    eventsText: events ? events.textContent.replace(/\s+/g, ' ').slice(0, 300) : null,
    kvText: kv ? kv.textContent.replace(/\s+/g, ' ').slice(0, 300) : null,
    stateBadge: document.querySelector('[class*="liveWorkStateBadge"]')?.textContent?.trim() || null,
  };
});
console.log('LIVEWORK_BODY ' + JSON.stringify(body));

await j('/api/background-tasks/' + task.body?.taskId + '/cancel', { method: 'POST' });
await browser.disconnect();
