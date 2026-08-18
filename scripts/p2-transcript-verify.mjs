// P2 verification: bounded transcript scroll + auto-follow + scroll-up
// resistance during message appends (real sends, failing provider appends).
import puppeteer from 'puppeteer-core';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((p) => p.url().includes('file://')) || pages[0];
await app.setViewport({ width: 1600, height: 900 });
await app.evaluate(() => { location.hash = '#/jarvis'; });
await sleep(6000);
await app.evaluate(() => { const t = [...document.querySelectorAll('button')].find((b) => /SHOW DOCK/i.test(b.textContent || '')); if (t) t.click(); });
await sleep(1000);

const send = async (text) => {
  const typed = await app.evaluate((t) => {
    const ta = document.querySelector('textarea');
    if (!ta) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
    if (setter) setter.call(ta, t);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }, text);
  if (!typed) return;
  await sleep(400);
  await app.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.getAttribute('aria-label') === 'Send Message'); if (b) b.click(); });
  await sleep(4000);
};

const measure = () => app.evaluate(() => {
  const sc = document.querySelector('[data-testid="jarvis-chat-scroll"]');
  const frame = document.querySelector('[data-testid="jarvis-chat-scroll-frame"]');
  const composer = document.querySelector('textarea');
  const jump = [...document.querySelectorAll('button')].find((b) => /Jump to latest/i.test(b.textContent || ''));
  return {
    clientH: sc ? sc.clientHeight : null,
    scrollH: sc ? sc.scrollHeight : null,
    frameH: frame ? frame.getBoundingClientRect().height : null,
    docScrollH: document.documentElement.scrollHeight,
    winH: window.innerHeight,
    docScrolls: document.documentElement.scrollHeight > window.innerHeight + 50,
    composerVisible: composer ? composer.getBoundingClientRect().height > 0 : false,
    jumpVisible: !!jump,
    lines: sc ? sc.querySelectorAll('[data-testid="jarvis-command-line"]').length : 0,
  };
});

const out = {};
out.before = await measure();
// build a long transcript (6 sends, each appends YOU + error/system lines)
const prompts = ['Alpha one', 'Beta two', 'Gamma three', 'Delta four', 'Epsilon five', 'Zeta six'];
for (const p of prompts) await send(p);
out.after6 = await measure();

// scroll-up resistance: scroll the transcript to the top, then send another
await app.evaluate(() => {
  const sc = document.querySelector('[data-testid="jarvis-chat-scroll"]');
  if (sc) sc.scrollTop = 0;
});
await sleep(600);
out.scrolledUp = await measure();
await send('Eta seven');
out.afterSendWhileScrolledUp = await measure();

// jump to latest restores the bottom
await app.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /Jump to latest/i.test(x.textContent || '')); if (b) b.click(); });
await sleep(800);
out.afterJump = await app.evaluate(() => {
  const sc = document.querySelector('[data-testid="jarvis-chat-scroll"]');
  return {
    atBottom: sc ? sc.scrollHeight - sc.scrollTop - sc.clientHeight < 140 : null,
    jumpVisible: !!([...document.querySelectorAll('button')].find((b) => /Jump to latest/i.test(b.textContent || ''))),
  };
});

console.log('RESULT ' + JSON.stringify(out, null, 1));
await browser.disconnect();
