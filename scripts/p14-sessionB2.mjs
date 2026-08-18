// P14 Session B v2: priority + continue (longer waits, real reply detection).
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

async function ask(text, tag, waitSec = 90) {
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
    break;
  }
  let reply = null;
  for (let i = 0; i < waitSec; i += 2) {
    await sleep(2000);
    reply = await app.evaluate((t) => {
      const sc = document.querySelector('[data-testid="jarvis-chat-scroll"]');
      if (!sc) return null;
      const text = sc.innerText;
      const idx = text.lastIndexOf(t);
      if (idx < 0) return null;
      const after = text.slice(idx, idx + 700);
      // a real reply: JARVIS content that is not just the task-start line
      if (/JARVIS\s*\n/.test(after)) {
        const jarvis = after.split('\n').filter((l) => l.startsWith('JARVIS'));
        if (jarvis.length && jarvis[0].length > 20) return after;
      }
      return null;
    }, text);
    if (reply) break;
  }
  console.log('--- ' + tag + ' ---');
  console.log(JSON.stringify(reply ? reply.replace(/\n/g, ' | ').slice(0, 600) : 'NO REPLY'));
  return reply;
}

await ask('What was our next priority?', 'Q2_PRIORITY');
await ask('Continue where we left off.', 'Q3_CONTINUE');

const act = await app.evaluate(async () => {
  const a = await (await fetch('http://localhost:4000/api/jarvis/memory-activity?limit=12')).json();
  return (Array.isArray(a) ? a : []).map((e) => `${e.kind}:${e.category}:${e.projectId || 'null'}`).slice(0, 10);
});
console.log('ACTIVITY ' + JSON.stringify(act));
await browser.disconnect();
