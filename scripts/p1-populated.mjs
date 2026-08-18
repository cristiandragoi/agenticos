// Populated-values check: real turn fills insights; verify no cell overflow.
import puppeteer from 'puppeteer-core';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((p) => p.url().includes('file://')) || pages[0];
await app.setViewport({ width: 1366, height: 768 });
await app.evaluate(() => { location.hash = '#/jarvis'; });
await sleep(6000);
await app.evaluate(() => { const t = [...document.querySelectorAll('button')].find((b) => /SHOW DOCK/i.test(b.textContent || '')); if (t) t.click(); });
await sleep(1000);

// send a real turn
await app.evaluate(() => {
  const ta = document.querySelector('textarea');
  if (!ta) return;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
  if (setter) setter.call(ta, 'Give me a short summary of the AgenticOS architecture in one sentence.');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
});
await sleep(300);
await app.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /send/i.test(x.textContent || '') || x.getAttribute('aria-label') === 'Send'); if (b) b.click(); });
// wait for the turn to complete
await sleep(30000);

const r = await app.evaluate(() => {
  const panel = document.querySelector('[data-testid="jarvis-insights"]');
  if (!panel) return { error: 'no panel' };
  const cells = [...panel.querySelectorAll('[data-insight]')];
  const out = cells.map((c) => {
    const rect = c.getBoundingClientRect();
    return {
      key: c.getAttribute('data-insight'),
      text: (c.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60),
      scrollW: c.scrollWidth,
      clientW: c.clientWidth,
      overflowsH: c.scrollWidth > c.clientWidth + 1,
    };
  });
  return { cells: out, anyHOverflow: out.some((x) => x.overflowsH) };
});
console.log('POPULATED ' + JSON.stringify(r, null, 1));
await app.screenshot({ path: 'scripts/p3-shots/insights-populated-1366.png' });
console.log('shot scripts/p3-shots/insights-populated-1366.png');
await browser.disconnect();
