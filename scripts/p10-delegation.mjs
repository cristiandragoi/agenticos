// P10: delegation truth — background tasks, worker identity, linked runs, UI.
import puppeteer from 'puppeteer-core';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((p) => p.url().includes('file://')) || pages[0];

const api = await app.evaluate(async () => {
  const tasks = await (await fetch('http://localhost:4000/api/background-tasks')).json();
  const runs = await (await fetch('http://localhost:4000/api/hermes-api/runs')).json();
  const summary = await (await fetch('http://localhost:4000/api/background-tasks/summary')).json();
  return { tasks, runs, summary };
});
const t = Array.isArray(api.tasks) ? api.tasks : api.tasks?.tasks || [];
console.log('TASKS ' + JSON.stringify(t.slice(0, 4).map((x) => ({ taskId: x.taskId, title: (x.title || '').slice(0, 40), worker: x.worker, status: x.status, linkedRunId: x.linkedRunId, updatedAt: x.updatedAt }))));
const rs = Array.isArray(api.runs) ? api.runs : api.runs?.runs || [];
console.log('RUNS ' + JSON.stringify(rs.slice(0, 3).map((r) => ({ id: (r.id || r.runId || '').slice(0, 30), status: r.status, agent: r.agent || r.worker || null }))));
console.log('SUMMARY ' + JSON.stringify(api.summary).slice(0, 200));

// UI: LIVE WORK + ACTIVE RUN panel
await app.goto('file:///B:/AgenticOS/dist/index.html', { waitUntil: 'load' });
await sleep(4000);
await app.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => /Retry connection/i.test(x.textContent || ''));
  if (b) b.click();
});
await sleep(6000);
await app.evaluate(() => { location.hash = '#/jarvis'; });
await sleep(2500);
await app.evaluate(() => {
  const t2 = [...document.querySelectorAll('button')].find((x) => /SHOW DOCK/i.test(x.textContent || ''));
  if (t2) t2.click();
});
await sleep(2000);
const ui = await app.evaluate(() => {
  const text = document.body.innerText;
  const ar = text.indexOf('ACTIVE RUN');
  return {
    liveWork: text.slice(text.indexOf('LIVE WORK'), text.indexOf('LIVE WORK') + 500).replace(/\n/g, ' | ').slice(0, 400),
    activeRun: ar >= 0 ? text.slice(ar, ar + 260).replace(/\n/g, ' | ') : '(no active run panel)',
  };
});
console.log('UI ' + JSON.stringify(ui, null, 1));
await browser.disconnect();
