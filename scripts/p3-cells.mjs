// Probe insight cells directly (data-insight), send a turn, re-probe.
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
await sleep(2000);

const cells = async (tag) => {
  const c = await app.evaluate(() => {
    const out = {};
    document.querySelectorAll('[data-insight]').forEach((el) => {
      out[el.getAttribute('data-insight')] = (el.innerText || '').slice(0, 90);
    });
    return out;
  });
  console.log(tag + ' ' + JSON.stringify(c));
};

await cells('before');
await app.evaluate(() => {
  const ta = document.querySelector('textarea');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
  if (setter) setter.call(ta, 'Activity probe three');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
});
await sleep(500);
await app.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.getAttribute('aria-label') === 'Send Message'); if (b) b.click(); });
await sleep(3000);
await cells('mid');
await sleep(8000);
await cells('after');
await browser.disconnect();
