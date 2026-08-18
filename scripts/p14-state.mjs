// What does the transcript actually show now (after the 3 asks)?
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
  const i1 = text.lastIndexOf('What project are we working on?');
  const i2 = text.lastIndexOf('What was our next priority?');
  const i3 = text.lastIndexOf('Continue where we left off.');
  const tail = text.slice(Math.max(0, text.length - 700));
  const rt = await (await fetch('http://localhost:4000/api/jarvis/runtime-state')).json();
  return {
    q1: i1 >= 0 ? text.slice(i1, i1 + 420).replace(/\n/g, ' | ') : 'MISSING',
    q2: i2 >= 0 ? text.slice(i2, i2 + 420).replace(/\n/g, ' | ') : 'MISSING',
    q3: i3 >= 0 ? text.slice(i3, i3 + 420).replace(/\n/g, ' | ') : 'MISSING',
    runtimeState: { state: rt.state, action: rt.activeTask?.action || null, activeAgent: rt.activeAgent },
  };
});
console.log(JSON.stringify(out, null, 1));
await browser.disconnect();
