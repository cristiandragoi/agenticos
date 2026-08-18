// Inspect bgtask-15a231a75: full record + events + linked run.
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((p) => p.url().includes('file://')) || pages[0];
const out = await app.evaluate(async () => {
  const base = 'http://localhost:4000/api';
  const tasks = await (await fetch(`${base}/background-tasks`)).json();
  const t = (Array.isArray(tasks) ? tasks : tasks.tasks || []).find((x) => x.taskId === 'bgtask-15a231a75');
  let events = [];
  let run = null;
  if (t) {
    try {
      const e = await fetch(`${base}/background-tasks/${t.taskId}/events`);
      events = await e.json();
    } catch { }
    if (t.linkedRunId) {
      try {
        const r = await fetch(`${base}/hermes-api/runs/${t.linkedRunId}`);
        run = await r.json();
      } catch { }
    }
  }
  return {
    task: t ? {
      taskId: t.taskId, title: t.title, worker: t.worker, status: t.status,
      progressMessage: t.progressMessage, currentStage: t.currentStage,
      linkedRunId: t.linkedRunId, projectId: t.projectId,
      createdAt: t.createdAt, updatedAt: t.updatedAt,
      error: t.error || null, result: t.result || null,
    } : null,
    events: (Array.isArray(events) ? events : []).slice(0, 12).map((e) => ({ kind: e.kind, summary: (e.summary || '').slice(0, 90), ts: e.ts })),
    run: run ? { id: run.id, status: run.status, agent: run.agent, text: (run.text || '').slice(0, 200) } : null,
  };
});
console.log(JSON.stringify(out, null, 1));
await browser.disconnect();
