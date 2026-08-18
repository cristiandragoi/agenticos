// What happened after the send? Full state: understood cell, conversation id.
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
const pre = await app.evaluate(() => {
  const u = document.querySelector('[data-insight="understood"]');
  return { understood: u ? u.innerText.slice(0, 60) : null, hash: location.hash };
});
console.log('PRE ' + JSON.stringify(pre));
await app.evaluate(() => {
  const ta = document.querySelector('textarea');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
  if (setter) setter.call(ta, 'P11 second attempt');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
});
await sleep(600);
await app.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.getAttribute('aria-label') === 'Send Message'); if (b) b.click(); });
for (let i = 0; i < 10; i++) {
  await sleep(600);
  const s = await app.evaluate(() => {
    const u = document.querySelector('[data-insight="understood"]');
    return { understood: u ? u.innerText.replace('UNDERSTOOD\n', '').slice(0, 50) : null };
  });
  if (s.understood && s.understood !== '—') { console.log('T+' + i * 0.6 + ' ' + JSON.stringify(s)); }
}
await browser.disconnect();
