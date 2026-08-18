// P9: start a delegated CodeX task, cancel it mid-run, verify propagation.
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

const beforeTasks = await app.evaluate(async () => {
  const r = await fetch('http://localhost:4000/api/background-tasks');
  const j = await r.json();
  return (Array.isArray(j) ? j : j.tasks || []).map((x) => x.taskId);
});

// send a delegated task (proven delegation prompt)
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
await sleep(12000);

// find the new task (poll up to 20s)
let newTask = null;
for (let i = 0; i < 4 && !newTask; i++) {
  newTask = await app.evaluate(async (before) => {
    const r = await fetch('http://localhost:4000/api/background-tasks');
    const j = await r.json();
    const all = Array.isArray(j) ? j : j.tasks || [];
    const fresh = all.filter((x) => !before.includes(x.taskId));
    return fresh.map((x) => ({ id: x.taskId, worker: x.worker, status: x.status, linkedRunId: x.linkedRunId })).pop() || null;
  }, beforeTasks);
  if (!newTask) await sleep(5000);
}
console.log('NEWTASK ' + JSON.stringify(newTask));
if (!newTask) { console.log('NO TASK FOUND'); await browser.disconnect(); process.exit(0); }

// wait for it to enter planning/execution, then cancel
await sleep(12000);
const preCancel = await app.evaluate(async (id) => {
  const r = await fetch('http://localhost:4000/api/background-tasks');
  const j = await r.json();
  const all = Array.isArray(j) ? j : j.tasks || [];
  const t = all.find((x) => x.taskId === id);
  return t ? { status: t.status, currentStage: t.currentStage } : null;
}, newTask.id);
console.log('PRE_CANCEL ' + JSON.stringify(preCancel));

const cancelRes = await app.evaluate(async (id) => {
  const r = await fetch(`http://localhost:4000/api/background-tasks/${id}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: 'P9 cancellation test' }),
  });
  return { status: r.status, body: (await r.text()).slice(0, 120) };
}, newTask.id);
console.log('CANCEL_RES ' + JSON.stringify(cancelRes));

await sleep(8000);
const post = await app.evaluate(async (id) => {
  const r = await fetch('http://localhost:4000/api/background-tasks');
  const j = await r.json();
  const all = Array.isArray(j) ? j : j.tasks || [];
  const t = all.find((x) => x.taskId === id);
  const text = document.body.innerText;
  const ar = text.indexOf('ACTIVE RUN');
  return {
    status: t ? t.status : 'GONE',
    blocker: t ? t.blocker : null,
    linkedRunId: t ? t.linkedRunId : null,
    activeRun: ar >= 0 ? text.slice(ar, ar + 90).replace(/\n/g, ' | ') : 'NO PANEL',
  };
}, newTask.id);
console.log('POST_CANCEL ' + JSON.stringify(post, null, 1));

// next turn works immediately
for (let attempt = 0; attempt < 3; attempt++) {
  await app.evaluate((t) => {
    const ta = document.querySelector('textarea');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
    if (setter) setter.call(ta, t);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }, 'Reply with exactly: POST_CANCEL_OK');
  await sleep(500);
  const v = await app.evaluate(() => document.querySelector('textarea')?.value || '');
  if (v !== 'Reply with exactly: POST_CANCEL_OK') continue;
  await app.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.getAttribute('aria-label') === 'Send Message');
    if (b) b.click();
  });
  break;
}
await sleep(15000);
const nextTurn = await app.evaluate(() => {
  const sc = document.querySelector('[data-testid="jarvis-chat-scroll"]');
  const text = sc ? sc.innerText : '';
  const idx = text.lastIndexOf('POST_CANCEL_OK');
  return idx >= 0 ? text.slice(idx, idx + 250).replace(/\n/g, ' | ') : 'NO REPLY';
});
console.log('NEXT_TURN ' + JSON.stringify(nextTurn));
await browser.disconnect();
