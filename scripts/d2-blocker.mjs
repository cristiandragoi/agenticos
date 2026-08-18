// Full failed-task record: blocker, lastError, metadata.
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((p) => p.url().includes('file://')) || pages[0];
const out = await app.evaluate(async () => {
  const tasks = await (await fetch('http://localhost:4000/api/background-tasks')).json();
  const all = Array.isArray(tasks) ? tasks : tasks.tasks || [];
  const t = all.find((x) => x.taskId === 'bgtask-fabf673a6');
  if (!t) return { err: 'not found' };
  return {
    blocker: t.blocker || null,
    lastError: t.lastError || null,
    status: t.status,
    currentStage: t.currentStage,
    approvalState: t.approvalState || null,
    metadata: t.metadata || null,
    progressMessage: t.progressMessage,
  };
});
console.log(JSON.stringify(out, null, 1));
await browser.disconnect();
