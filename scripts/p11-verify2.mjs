// P11 verify v2: confirm each send via UNDERSTOOD, then check BLOCKED.
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

const cell = async (key) => {
  return app.evaluate((k) => {
    const el = document.querySelector(`[data-insight="${k}"]`);
    return el ? el.innerText.split('\n').slice(1).join('').slice(0, 110) : null;
  }, key);
};

const sendTurn = async (text) => {
  // set + click + confirm understood updates
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
    // wait for understood to become the text
    for (let i = 0; i < 10; i++) {
      await sleep(400);
      const u = await cell('understood');
      if (u === text) return { fired: true, attempt };
    }
  }
  return { fired: false };
};

const r1 = await sendTurn('Reply with exactly: DURABLE_ERROR_PROBE');
console.log('SEND1 ' + JSON.stringify(r1));
await sleep(6000);
console.log('BLOCKED-1 ' + JSON.stringify(await cell('blocked')));
console.log('ACTIVE-1 ' + JSON.stringify(await cell('active')));
await sleep(5000);
console.log('BLOCKED-2 ' + JSON.stringify(await cell('blocked')));
const r2 = await sendTurn('Reply with exactly: RECOVERY_PROBE');
console.log('SEND2 ' + JSON.stringify(r2));
await sleep(3000);
console.log('MID2 BLOCKED ' + JSON.stringify(await cell('blocked')));
await sleep(6000);
console.log('AFTER2 BLOCKED ' + JSON.stringify(await cell('blocked')));
await browser.disconnect();
