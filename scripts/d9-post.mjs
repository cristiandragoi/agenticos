// Post-cancel: did the next turn reply? + goal state.
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
const out = await app.evaluate(async () => {
  const sc = document.querySelector('[data-testid="jarvis-chat-scroll"]');
  const text = sc ? sc.innerText : '';
  const idx = text.lastIndexOf('POST_CANCEL_OK');
  const tail = idx >= 0 ? text.slice(idx, idx + 400) : 'NO PROMPT IN TRANSCRIPT';
  const tasks = await (await fetch('http://localhost:4000/api/background-tasks')).json();
  const all = Array.isArray(tasks) ? tasks : tasks.tasks || [];
  const t = all.find((x) => x.taskId === 'bgtask-d28fb35dd');
  const text2 = document.body.innerText;
  const ar = text2.indexOf('ACTIVE RUN');
  return {
    nextTurn: tail.replace(/\n/g, ' | ').slice(0, 350),
    taskStatus: t ? t.status : 'GONE',
    activeRun: ar >= 0 ? text2.slice(ar, ar + 80).replace(/\n/g, ' | ') : 'NO PANEL',
  };
});
console.log(JSON.stringify(out, null, 1));
await browser.disconnect();
