// Inspect the failed CodeX task: error, events, links.
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((p) => p.url().includes('file://')) || pages[0];
const out = await app.evaluate(async () => {
  const base = 'http://localhost:4000/api';
  const tasks = await (await fetch(`${base}/background-tasks`)).json();
  const all = Array.isArray(tasks) ? tasks : tasks.tasks || [];
  const t = all.find((x) => x.taskId === 'bgtask-fabf673a6');
  const fields = {};
  if (t) for (const k of ['taskId', 'worker', 'status', 'error', 'progressMessage', 'currentStage', 'linkedRunId', 'parentTaskId', 'childTaskIds', 'updatedAt', 'createdAt']) fields[k] = t[k];
  let events = [];
  try {
    const e = await fetch(`${base}/background-tasks/${t.taskId}/events`);
    const j = await e.json();
    events = (Array.isArray(j) ? j : []).slice(0, 14).map((x) => ({ kind: x.kind, summary: (x.summary || '').slice(0, 80) }));
  } catch (err) { events = [{ err: String(err) }]; }
  return { fields, events };
});
console.log(JSON.stringify(out, null, 1));
await browser.disconnect();
