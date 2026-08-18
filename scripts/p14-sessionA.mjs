// P14 Session A: select AgenticOS + store the durable project context.
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

// 1. set the active project
const setRes = await app.evaluate(async () => {
  const r = await fetch('http://localhost:4000/api/projects/active', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId: 'proj-ac4c89f0' }),
  });
  return { status: r.status, body: (await r.text()).slice(0, 120) };
});
console.log('SET_ACTIVE ' + JSON.stringify(setRes));

// 2. store the durable project context (explicit STORE -> project-scoped)
const STORE_TEXT = 'Please remember that the next priority after delegation is project memory continuity.';
for (let attempt = 0; attempt < 3; attempt++) {
  await app.evaluate((t) => {
    const ta = document.querySelector('textarea');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
    if (setter) setter.call(ta, t);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }, STORE_TEXT);
  await sleep(500);
  const v = await app.evaluate(() => document.querySelector('textarea')?.value || '');
  if (v !== STORE_TEXT) continue;
  await app.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.getAttribute('aria-label') === 'Send Message');
    if (b) b.click();
  });
  break;
}
await sleep(8000);
const storeReply = await app.evaluate((t) => {
  const sc = document.querySelector('[data-testid="jarvis-chat-scroll"]');
  if (!sc) return 'NO SCROLL';
  const text = sc.innerText;
  const idx = text.lastIndexOf(t);
  return idx >= 0 ? text.slice(idx, idx + 350).replace(/\n/g, ' | ') : 'NOT FOUND';
}, STORE_TEXT);
console.log('STORE_REPLY ' + JSON.stringify(storeReply));

// 3. verify the project-scoped memory + the memory activity events
const verify = await app.evaluate(async () => {
  const mem = await (await fetch('http://localhost:4000/api/memory/search?q=priority&scope=project:proj-ac4c89f0')).json();
  const act = await (await fetch('http://localhost:4000/api/jarvis/memory-activity?limit=10')).json();
  const items = (mem.items || mem || []).slice(0, 3).map((m) => ({ id: m.id, title: m.title, scope: m.scope, type: m.type }));
  return { memories: items, activity: (Array.isArray(act) ? act : []).slice(0, 6).map((e) => ({ kind: e.kind, projectId: e.projectId, category: e.category })) };
});
console.log('VERIFY ' + JSON.stringify(verify, null, 1));
await browser.disconnect();
