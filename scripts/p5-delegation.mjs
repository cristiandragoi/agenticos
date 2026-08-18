// P5: Jarvis→Hermes delegation (real task) + P7: error recovery recheck.
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

const cell = async (key) => app.evaluate((k) => {
  const el = document.querySelector(`[data-insight="${k}"]`);
  return el ? el.innerText.split('\n').slice(1).join('').slice(0, 110) : null;
}, key);

const sendTurn = async (text) => {
  for (let attempt = 0; attempt < 3; attempt++) {
    await app.evaluate((t) => {
      const ta = document.querySelector('textarea');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
      if (setter) setter.call(ta, t);
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }, text);
    await sleep(500);
    const v = await app.evaluate(() => document.querySelector('textarea')?.value || '');
    if (v !== text) continue;
    await app.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.getAttribute('aria-label') === 'Send Message');
      if (b) b.click();
    });
    return true;
  }
  return false;
};

// P5: delegation prompt (actionable → Hermes)
await sendTurn('Create a plan to review the AgenticOS project git history');
await sleep(9000);
const p5 = await app.evaluate(() => {
  const sc = document.querySelector('[data-testid="jarvis-chat-scroll"]');
  const text = sc ? sc.innerText : '';
  const idx = text.lastIndexOf('Create a plan to review');
  const after = idx >= 0 ? text.slice(idx, idx + 600) : 'PROMPT NOT FOUND';
  return { routing: after.replace(/\n/g, ' | ').slice(0, 500) };
});
console.log('P5ROUTE ' + JSON.stringify(p5.routing));
const tasks = await app.evaluate(async () => {
  const r = await fetch('http://localhost:4000/api/background-tasks');
  const j = await r.json();
  const t = Array.isArray(j) ? j : j.tasks || [];
  return t.slice(0, 3).map((x) => ({ id: x.taskId, title: (x.title || '').slice(0, 50), worker: x.worker, status: x.status }));
});
console.log('P5TASKS ' + JSON.stringify(tasks));

// P7: a simple success turn — BLOCKED must be — and ACTIVE — after
await sendTurn('Reply with exactly: P7_RECOVERY_OK');
await sleep(10000);
const p7 = await app.evaluate(() => {
  const sc = document.querySelector('[data-testid="jarvis-chat-scroll"]');
  const text = sc ? sc.innerText : '';
  const idx = text.lastIndexOf('P7_RECOVERY_OK');
  return {
    hasReply: idx >= 0 ? text.slice(idx, idx + 300) : 'NO TURN FOUND',
    blocked: document.querySelector('[data-insight="blocked"]')?.innerText.split('\n').slice(1).join('').slice(0, 60),
    active: document.querySelector('[data-insight="active"]')?.innerText.split('\n').slice(1).join('').slice(0, 60),
  };
});
console.log('P7 ' + JSON.stringify(p7, null, 1));
await browser.disconnect();
