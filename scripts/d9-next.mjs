// Post-cancel: verify a new user turn works (robust send + longer wait).
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

const TEXT = 'Reply with exactly: POST_CANCEL_OK2';
let sent = false;
for (let attempt = 0; attempt < 3; attempt++) {
  await app.evaluate((t) => {
    const ta = document.querySelector('textarea');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
    if (setter) setter.call(ta, t);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }, TEXT);
  await sleep(500);
  const v = await app.evaluate(() => document.querySelector('textarea')?.value || '');
  if (v !== TEXT) continue;
  await app.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.getAttribute('aria-label') === 'Send Message');
    if (b) b.click();
  });
  sent = true;
  break;
}
console.log('SENT ' + sent);
// wait for a JARVIS reply after the prompt (up to 90s — local model is slow)
let reply = null;
for (let i = 0; i < 45; i++) {
  await sleep(2000);
  reply = await app.evaluate((t) => {
    const sc = document.querySelector('[data-testid="jarvis-chat-scroll"]');
    if (!sc) return null;
    const text = sc.innerText;
    const idx = text.lastIndexOf(t);
    if (idx < 0) return null;
    const after = text.slice(idx, idx + 500);
    return /(JARVIS|SYSTEM)\n/.test(after) ? after : null;
  }, TEXT);
  if (reply) { console.log('REPLY ' + JSON.stringify(reply.replace(/\n/g, ' | ').slice(0, 400))); break; }
}
if (!reply) console.log('NO REPLY after 90s');
await browser.disconnect();
