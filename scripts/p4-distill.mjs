// P4: run a real CodeX task under the active project → verify auto-distillation.
import puppeteer from 'puppeteer-core';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((p) => p.url().includes('file://')) || pages[0];
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
  const t = [...document.querySelectorAll('button')].find((x) => /SHOW DOCK/i.test(x.textContent || ''));
  if (t) t.click();
});
await sleep(1500);

// 1. ensure the active project
await app.evaluate(async () => {
  await fetch('http://localhost:4000/api/projects/active', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId: 'proj-ac4c89f0' }),
  });
});
console.log('ACTIVE_SET');

const beforeTasks = await app.evaluate(async () => {
  const r = await fetch('http://localhost:4000/api/background-tasks');
  const j = await r.json();
  return (Array.isArray(j) ? j : j.tasks || []).map((x) => x.taskId);
});

// 2. run a real CodeX task
const PROMPT = 'Review the current AgenticOS project and ask CodeX to inspect one small issue. Tell me what it found.';
for (let attempt = 0; attempt < 3; attempt++) {
  await app.evaluate((t) => {
    const ta = document.querySelector('textarea');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
    if (setter) setter.call(ta, t);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }, PROMPT);
  await sleep(500);
  const v = await app.evaluate(() => document.querySelector('textarea')?.value || '');
  if (v !== PROMPT) continue;
  await app.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.getAttribute('aria-label') === 'Send Message');
    if (b) b.click();
  });
  break;
}
await sleep(10000);

// 3. find the new task + its projectId
let task = null;
for (let i = 0; i < 6 && !task; i++) {
  task = await app.evaluate(async (before) => {
    const r = await fetch('http://localhost:4000/api/background-tasks');
    const j = await r.json();
    const all = Array.isArray(j) ? j : j.tasks || [];
    const fresh = all.filter((x) => !before.includes(x.taskId));
    return fresh.map((x) => ({ id: x.taskId, worker: x.worker, status: x.status, projectId: x.projectId })).pop() || null;
  }, beforeTasks);
  if (!task) await sleep(5000);
}
console.log('TASK ' + JSON.stringify(task));

// 4. wait for completion (up to 4 min)
for (let i = 0; i < 24; i++) {
  await sleep(10000);
  const snap = await app.evaluate(async (id) => {
    const r = await fetch('http://localhost:4000/api/background-tasks');
    const j = await r.json();
    const all = Array.isArray(j) ? j : j.tasks || [];
    const t = all.find((x) => x.taskId === id);
    return t ? { status: t.status, projectId: t.projectId, verification: t.verificationState } : null;
  }, task.id);
  if (snap && ['completed', 'failed', 'cancelled'].includes(snap.status)) {
    console.log('FINAL ' + JSON.stringify(snap));
    break;
  }
  if (i === 23) console.log('TIMEOUT ' + JSON.stringify(snap));
}

// 5. verify the auto-distilled project memory
await sleep(3000);
const verify = await app.evaluate(async (taskId) => {
  const mem = await (await fetch('http://localhost:4000/api/memory/search?q=inspection&scope=project:proj-ac4c89f0')).json();
  const items = (Array.isArray(mem) ? mem : []).map((x) => ({
    id: x.memory?.id, title: x.memory?.title, scope: x.memory?.scope,
    worker: x.memory?.source?.worker, taskId: x.memory?.source?.taskId, type: x.memory?.type,
  }));
  return items.slice(0, 6);
}, task.id);
console.log('DISTILLED ' + JSON.stringify(verify, null, 1));
await browser.disconnect();
