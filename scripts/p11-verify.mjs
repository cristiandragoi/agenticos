// P11 verify: durable BLOCKED error after a failed turn + clear on next request.
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

const cells = async (tag) => {
  const c = await app.evaluate(() => {
    const blk = document.querySelector('[data-insight="blocked"]');
    const act = document.querySelector('[data-insight="active"]');
    return { blocked: blk ? blk.innerText.replace('BLOCKED / ATTENTION\n', '').slice(0, 110) : null, active: act ? act.innerText.replace('ACTIVE WORK\n', '').slice(0, 50) : null };
  });
  console.log(tag + ' ' + JSON.stringify(c));
};

const sendTurn = async (text) => {
  await app.evaluate((t) => {
    const ta = document.querySelector('textarea');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
    if (setter) setter.call(ta, t);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }, text);
  await sleep(600);
  const fired = await app.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.getAttribute('aria-label') === 'Send Message');
    if (b) { b.click(); return true; }
    return false;
  });
  return fired;
};

await cells('start');
await sendTurn('P11 durable error probe');
await sleep(6000);
await cells('after-fail-6s');
await sleep(4000);
await cells('after-fail-10s');
// recovery: next request clears the error
await sendTurn('P11 recovery probe');
await sleep(2500);
await cells('mid-next-turn');
await sleep(6000);
await cells('after-next-turn');
await browser.disconnect();
