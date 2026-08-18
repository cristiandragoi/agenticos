// P4: ASSIGNED (config) vs ACTIVE (effective path) — idle + mid-turn.
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
    // find ASSIGNED + ACTIVE pairs in the workspace column
    const lines = text.split('\n');
    const out = { assigned: [], active: [] };
    for (let i = 0; i < lines.length; i++) {
      if (lines[i] === 'ASSIGNED') out.assigned.push(lines[i + 1] || '');
      if (lines[i] === 'ACTIVE' && out.active.length < 3) out.active.push(lines[i + 1] || '');
    }
    // System Status kv (bottom of dock)
    return out;
  });
  console.log(tag + ' ' + JSON.stringify(g));
};

await grab('idle');
// real turn
await app.evaluate(() => {
  const ta = document.querySelector('textarea');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
  if (setter) setter.call(ta, 'ASSIGNED vs ACTIVE probe');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
});
await sleep(500);
await app.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.getAttribute('aria-label') === 'Send Message'); if (b) b.click(); });
await sleep(3000);
await grab('mid-turn');
await sleep(8000);
await grab('after');
await browser.disconnect();
