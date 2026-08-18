// Post-completion: task record + ACTIVE RUN truth.
import puppeteer from 'puppeteer-core';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((p) => p.url().includes('file://')) || pages[0];
await app.goto('file:///B:/AgenticOS/dist/index.html', { waitUntil: 'load' });
await sleep(3000);
await app.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => /Retry connection/i.test(x.textContent || ''));
  if (b) b.click();
});
await sleep(5000);
await app.evaluate(() => { location.hash = '#/jarvis'; });
await sleep(2500);
await app.evaluate(() => {
  const t = [...document.querySelectorAll('button')].find((x) => /SHOW DOCK/i.test(x.textContent || ''));
  if (t) t.click();
});
await sleep(1500);
const out = await app.evaluate(async () => {
  const tasks = await (await fetch('http://localhost:4000/api/background-tasks')).json();
  const all = Array.isArray(tasks) ? tasks : tasks.tasks || [];
  const t = all.find((x) => x.taskId === 'bgtask-ddd1ddea1');
  const record = t ? {
    status: t.status, worker: t.worker, linkedRunId: t.linkedRunId, parentTaskId: t.parentTaskId,
    resultText: (t.resultText || '').slice(0, 200),
    verificationState: t.verificationState,
    filesChanged: t.filesChanged,
    updatedAt: t.updatedAt,
  } : null;
  const text = document.body.innerText;
  const ar = text.indexOf('ACTIVE RUN');
  const activeRun = ar >= 0 ? text.slice(ar, ar + 120).replace(/\n/g, ' | ') : 'NO PANEL';
  return { record, activeRun };
});
console.log(JSON.stringify(out, null, 1));
await browser.disconnect();
