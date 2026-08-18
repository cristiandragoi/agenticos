// Fresh reload, then create task and watch the orb + poll with page-side fetch.
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

const task = await j('/api/background-tasks', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: 'Reload poll proof', objective: 'poll', worker: 'research', dispatch: false }),
});
console.log('TASK', task.body?.taskId, task.body?.status);
for (let i = 0; i < 6; i++) {
  await sleep(2000);
  const ui = await app.evaluate(() => ({
    state: document.querySelector('[data-testid="jarvis-orb"]')?.getAttribute('data-orb-state'),
    label: document.querySelector('[data-testid="jarvis-orb-status-label"]')?.textContent.trim(),
  }));
  const be = await j('/api/jarvis/runtime-state');
  console.log('T+' + ((i + 1) * 2) + 's backend=' + be.body?.state + ' ui=' + ui.state + ' ' + ui.label);
}
await j('/api/background-tasks/' + task.body?.taskId + '/cancel', { method: 'POST' });
await browser.disconnect();
