// P3: multi-turn conversation with the working model (qwen3.5:4b local).
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
  return el ? el.innerText.split('\n').slice(1).join('').slice(0, 100) : null;
}, key);

const sendTurn = async (text, tag) => {
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
    for (let i = 0; i < 12; i++) {
      await sleep(500);
      const u = await cell('understood');
      if (u === text) break;
    }
    // wait for the turn to settle (model reply or error)
    await sleep(12000);
    const tail = await app.evaluate(() => {
      const sc = document.querySelector('[data-testid="jarvis-chat-scroll"]');
      return sc ? sc.innerText.split('\n').slice(-10) : [];
    });
    const active = await cell('active');
    const blocked = await cell('blocked');
    console.log('--- ' + tag + ' ---');
    console.log('ACTIVE ' + JSON.stringify(active));
    console.log('BLOCKED ' + JSON.stringify(blocked));
    console.log('TAIL ' + JSON.stringify(tail));
    return { tail, active, blocked };
  }
  return null;
};

await sendTurn('My project codename is Atlas.', 'TURN1');
await sendTurn('What codename did I just give you?', 'TURN2');
await sendTurn('What were we discussing before I gave you that codename?', 'TURN3');
await browser.disconnect();
