// P3 clean: 3 turns, capture routing SYSTEM lines + real replies per turn.
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
    // wait until a JARVIS/agent reply line appears after this prompt
    for (let i = 0; i < 40; i++) {
      await sleep(1000);
      const reply = await app.evaluate((t) => {
        const sc = document.querySelector('[data-testid="jarvis-chat-scroll"]');
        if (!sc) return null;
        const text = sc.innerText;
        const idx = text.lastIndexOf(t);
        if (idx < 0) return null;
        const after = text.slice(idx, idx + 700);
        const hasReply = /(JARVIS|SYSTEM)\n/.test(after);
        return hasReply ? after : null;
      }, text);
      if (reply) {
        console.log('--- ' + tag + ' settled at ~' + (i + 1) + 's ---');
        console.log(reply.slice(0, 500).replace(/\n/g, ' | '));
        return;
      }
    }
    console.log('--- ' + tag + ' NO REPLY (timeout) ---');
    return;
  }
};

await sendTurn('My project codename is Atlas.', 'TURN1');
await sleep(3000);
await sendTurn('What codename did I just give you?', 'TURN2');
await sleep(3000);
await sendTurn('What were we discussing before I gave you that codename?', 'TURN3');
await browser.disconnect();
