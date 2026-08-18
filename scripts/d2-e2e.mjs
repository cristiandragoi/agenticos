// E2E: USER→JARVIS→HERMES→CODEX→result→JARVIS final. Long poll tasks.
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

// capture tasks BEFORE the send (to identify the new chain)
const beforeTasks = await app.evaluate(async () => {
  const r = await fetch('http://localhost:4000/api/background-tasks');
  const j = await r.json();
  return (Array.isArray(j) ? j : j.tasks || []).map((x) => x.taskId);
});

const PROMPT = 'Review the current AgenticOS project and ask CodeX to inspect one small issue. Tell me what it found.';
// send
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
await sleep(8000);

// capture routing line
const route = await app.evaluate(() => {
  const sc = document.querySelector('[data-testid="jarvis-chat-scroll"]');
  const text = sc ? sc.innerText : '';
  const idx = text.lastIndexOf('Review the current AgenticOS');
  return idx >= 0 ? text.slice(idx, idx + 500).replace(/\n/g, ' | ') : 'NOT FOUND';
});
console.log('ROUTE ' + JSON.stringify(route));

// poll the task chain for up to ~8 min
const newTasks = new Map();
for (let i = 0; i < 48; i++) {
  await sleep(10000);
  const snap = await app.evaluate(async (before) => {
    const r = await fetch('http://localhost:4000/api/background-tasks');
    const j = await r.json();
    const all = (Array.isArray(j) ? j : j.tasks || []);
    const fresh = all.filter((x) => !before.includes(x.taskId));
    return fresh.map((x) => ({ id: x.taskId, worker: x.worker, status: x.status, parent: x.parentTaskId || null, linkedRunId: x.linkedRunId || null, title: (x.title || '').slice(0, 60) }));
  }, beforeTasks);
  for (const t of snap) newTasks.set(t.id, t);
  const states = [...newTasks.values()].map((t) => `${t.id}:${t.worker}:${t.status}`).join(' | ');
  console.log('T+' + (i + 1) * 10 + 's ' + states);
  const allDone = [...newTasks.values()].every((t) => ['completed', 'failed', 'cancelled', 'blocked'].includes(t.status)) && newTasks.size > 0;
  if (allDone) { console.log('CHAIN_DONE'); break; }
}

// final: Jarvis reply + ACTIVE RUN
const final = await app.evaluate(() => {
  const sc = document.querySelector('[data-testid="jarvis-chat-scroll"]');
  const text = sc ? sc.innerText : '';
  const idx = text.lastIndexOf('Review the current AgenticOS');
  const tail = idx >= 0 ? text.slice(idx, idx + 900) : text.slice(-900);
  const ar = document.body.innerText.indexOf('ACTIVE RUN');
  return {
    jarvisReply: tail.replace(/\n/g, ' | ').slice(0, 700),
    activeRun: ar >= 0 ? document.body.innerText.slice(ar, ar + 160).replace(/\n/g, ' | ') : 'NO PANEL',
  };
});
console.log('FINAL ' + JSON.stringify(final, null, 1));
await browser.disconnect();
