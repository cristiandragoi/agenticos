// Debug: create task, check backend state repeatedly while sampling UI state.
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
const uiState = () => app.evaluate(() => {
  const canvas = document.querySelector('[data-testid="jarvis-orb"]');
  return { state: canvas?.getAttribute('data-orb-state'), label: document.querySelector('[data-testid="jarvis-orb-status-label"]')?.textContent.trim() };
});

const task = await j('/api/background-tasks', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: 'Poll debug', objective: 'debug', worker: 'research', dispatch: false }),
});
console.log('CREATED', task.status, task.body?.taskId, task.body?.status);
for (let i = 0; i < 6; i++) {
  await sleep(2000);
  const be = await j('/api/jarvis/runtime-state');
  const ui = await uiState();
  console.log('T+' + ((i + 1) * 2) + 's backend=' + be.body?.state + ' ui=' + ui.state + ' pending=' + be.body?.pendingTaskCount);
}
await j('/api/background-tasks/' + task.body?.taskId + '/cancel', { method: 'POST' });
await sleep(3000);
const be2 = await j('/api/jarvis/runtime-state');
const ui2 = await uiState();
console.log('AFTER_CANCEL backend=' + be2.body?.state + ' ui=' + ui2.state);
await browser.disconnect();
