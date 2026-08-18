// P3 live verification: real turn → capture LIVE WORK, insights, transcript.
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
await sleep(2500);
await app.evaluate(() => {
  const t = [...document.querySelectorAll('button')].find((x) => /LIVE WORK/i.test(x.textContent || '') && /SHOW/i.test(x.textContent || ''));
  if (t) t.click();
});
await sleep(1500);

const snap = async (tag) => {
  const s = await app.evaluate(() => {
    const text = document.body.innerText;
    const rows = {};
    for (const r of ['UNDERSTOOD', 'THINKING / PLAN', 'ACTIVE WORK', 'DELEGATED', 'RESULT', 'BLOCKED / ATTENTION']) {
      const i = text.indexOf(r);
      if (i >= 0) rows[r] = text.slice(i + r.length, i + r.length + 90).replace(/\n.*/, '').trim();
    }
    const lw = text.indexOf('LIVE WORK');
    const tr = text.indexOf('TRANSCRIPT');
    return { rows, liveWork: text.slice(lw, lw + 400), transcriptTail: text.slice(Math.max(0, tr - 60), tr + 500) };
  });
  console.log('--- ' + tag + ' ---');
  console.log('ROWS ' + JSON.stringify(s.rows, null, 1));
  console.log('LIVEWORK ' + s.liveWork.replace(/\n/g, ' | ').slice(0, 300));
  console.log('TRANSCRIPT ' + s.transcriptTail.replace(/\n/g, ' | ').slice(-400));
};

await snap('before');
// send a real turn
await app.evaluate(() => {
  const ta = document.querySelector('textarea');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
  if (setter) setter.call(ta, 'Activity probe turn — show what you see');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
});
await sleep(400);
await app.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.getAttribute('aria-label') === 'Send Message'); if (b) b.click(); });
await sleep(3500);
await snap('mid-turn');
await sleep(9000);
await snap('after');
await browser.disconnect();
