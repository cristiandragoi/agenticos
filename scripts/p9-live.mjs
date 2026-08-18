// P9 live verification: reproduce stale id → self-heal → endpoints → UI → routing.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((p) => p.url().includes('file://')) || pages[0];

// 1) reproduce the stale-ID case (write the ghost back)
fs.writeFileSync('server/data/active-project.json', JSON.stringify({ activeProjectId: 'proj-ghost' }), 'utf-8');
console.log('REPRO wrote proj-ghost');

// 2) call GET /api/projects (should report null + self-heal the file)
const api = await app.evaluate(async () => {
  const r = await fetch('http://localhost:4000/api/projects');
  return r.json();
});
console.log('PROJECTS ' + JSON.stringify(api));
console.log('FILE_AFTER ' + fs.readFileSync('server/data/active-project.json', 'utf-8'));

// 3) jarvis runtime-state
const rt = await app.evaluate(async () => {
  const r = await fetch('http://localhost:4000/api/jarvis/runtime-state');
  return r.json();
});
console.log('RUNTIME activeProject=' + JSON.stringify(rt.activeProject));

// 4) Projects UI: no ghost highlight
await app.goto('file:///B:/AgenticOS/dist/index.html', { waitUntil: 'load' });
await sleep(4000);
await app.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => /Retry connection/i.test(x.textContent || ''));
  if (b) b.click();
});
await sleep(6000);
await app.evaluate(() => { location.hash = '#/projects'; });
await sleep(3000);
const ui = await app.evaluate(() => {
  const text = document.body.innerText;
  const activeMarker = text.match(/ACTIVE[^\n]*/g)?.slice(0, 4) || [];
  const ghost = text.includes('proj-ghost') || text.includes('ghost');
  const proj = text.includes('AgenticOS');
  return { activeMarkers: activeMarker, ghostVisible: ghost, projectVisible: proj };
});
console.log('UI ' + JSON.stringify(ui));

// 5) ask Jarvis the project question (routing evidence; model reply 402-blocked)
await app.evaluate(() => { location.hash = '#/jarvis'; });
await sleep(2500);
await app.evaluate(() => {
  const t = [...document.querySelectorAll('button')].find((x) => /SHOW DOCK/i.test(x.textContent || ''));
  if (t) t.click();
});
await sleep(1500);
await app.evaluate(() => {
  const ta = document.querySelector('textarea');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
  if (setter) setter.call(ta, 'What project are we currently working on?');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
});
await sleep(500);
await app.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.getAttribute('aria-label') === 'Send Message'); if (b) b.click(); });
await sleep(5000);
const routing = await app.evaluate(() => {
  const sc = document.querySelector('[data-testid="jarvis-chat-scroll"]');
  return sc ? sc.innerText.split('\n').slice(-8) : [];
});
console.log('ROUTING ' + JSON.stringify(routing));
await browser.disconnect();
