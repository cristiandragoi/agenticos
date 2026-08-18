// Task record only (no events endpoint).
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((p) => p.url().includes('file://')) || pages[0];
const out = await app.evaluate(async () => {
  const tasks = await (await fetch('http://localhost:4000/api/background-tasks')).json();
  const all = Array.isArray(tasks) ? tasks : tasks.tasks || [];
  const t = all.find((x) => x.taskId === 'bgtask-fabf673a6');
  if (!t) return { err: 'task not found' };
  return {
    worker: t.worker, status: t.status,
    error: t.error || null,
    progressMessage: (t.progressMessage || '').slice(0, 300),
    currentStage: t.currentStage || null,
    linkedRunId: t.linkedRunId || null,
    parentTaskId: t.parentTaskId || null,
    updatedAt: t.updatedAt,
  };
});
console.log(JSON.stringify(out, null, 1));
await browser.disconnect();
