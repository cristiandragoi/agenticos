// P11: poll BLOCKED cell fast after a failed turn (catch the error flash).
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
await app.evaluate(() => {
  const ta = document.querySelector('textarea');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
  if (setter) setter.call(ta, 'P11 error state probe');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
});
await sleep(600);
const sent = await app.evaluate(() => {
  const ta = document.querySelector('textarea');
  const v = ta ? ta.value : '';
  if (!v) return false;
  const b = [...document.querySelectorAll('button')].find((x) => x.getAttribute('aria-label') === 'Send Message');
  if (b) b.click();
  return true;
});
console.log('SENT ' + sent);
const seen = [];
for (let i = 0; i < 24; i++) {
  const s = await app.evaluate(() => {
    const blk = document.querySelector('[data-insight="blocked"]');
    const act = document.querySelector('[data-insight="active"]');
    return { blocked: blk ? blk.innerText.replace('BLOCKED / ATTENTION\n', '').slice(0, 110) : null, active: act ? act.innerText.replace('ACTIVE WORK\n', '').slice(0, 60) : null };
  });
  if (s.blocked !== '—' || s.active !== '—') seen.push({ t: i * 0.25, ...s });
  await sleep(250);
}
console.log('ERRORFLASH ' + JSON.stringify(seen, null, 1));
const tail = await app.evaluate(() => {
  const sc = document.querySelector('[data-testid="jarvis-chat-scroll"]');
  return sc ? sc.innerText.split('\n').slice(-6) : [];
});
console.log('TRANSCRIPTTAIL ' + JSON.stringify(tail));
await browser.disconnect();
