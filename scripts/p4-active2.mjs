// P4 v2: confirm turn fired (UNDERSTOOD) + capture ACTIVE chip mid-turn.
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

const grab = async (tag) => {
  const g = await app.evaluate(() => {
    const text = document.body.innerText;
    const lines = text.split('\n');
    const out = { active: [], understood: null, activeWork: null };
    for (let i = 0; i < lines.length; i++) {
      if (lines[i] === 'ACTIVE' && out.active.length < 3) out.active.push(lines[i + 1] || '');
    }
    const u = document.querySelector('[data-insight="understood"]');
    const a = document.querySelector('[data-insight="active"]');
    out.understood = u ? u.innerText.replace('UNDERSTOOD\n', '').slice(0, 50) : null;
    out.activeWork = a ? a.innerText.replace('ACTIVE WORK\n', '').slice(0, 80) : null;
    return out;
  });
  console.log(tag + ' ' + JSON.stringify(g));
};

await grab('idle');
await app.evaluate(() => {
  const ta = document.querySelector('textarea');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
  if (setter) setter.call(ta, 'P4 active path probe');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
});
await sleep(500);
const val = await app.evaluate(() => document.querySelector('textarea')?.value);
await app.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.getAttribute('aria-label') === 'Send Message'); if (b) b.click(); });
console.log('textareaBeforeSend ' + JSON.stringify(val));
for (let i = 1; i <= 4; i++) {
  await sleep(2500);
  await grab('t+' + i * 2.5 + 's');
}
await browser.disconnect();
