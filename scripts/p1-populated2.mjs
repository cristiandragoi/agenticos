// Populated check after a real turn (UNDERSTOOD + BLOCKED should be filled).
import puppeteer from 'puppeteer-core';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((p) => p.url().includes('file://')) || pages[0];
await app.setViewport({ width: 1366, height: 768 });
await app.evaluate(() => { location.hash = '#/jarvis'; });
await sleep(5000);
const r = await app.evaluate(() => {
  const panel = document.querySelector('[data-testid="jarvis-insights"]');
  if (!panel) return { error: 'no panel' };
  const cells = [...panel.querySelectorAll('[data-insight]')];
  const out = cells.map((c) => {
    const rect = c.getBoundingClientRect();
    return {
      key: c.getAttribute('data-insight'),
      text: (c.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 70),
      scrollW: c.scrollWidth, clientW: c.clientWidth,
      overflowsH: c.scrollWidth > c.clientWidth + 1,
    };
  });
  const heads = cells.map((c) => c.firstElementChild.getBoundingClientRect());
  let overlaps = 0;
  for (let i = 0; i < heads.length; i++) for (let j = i + 1; j < heads.length; j++) {
    const a = heads[i], b = heads[j];
    if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) overlaps++;
  }
  return { cells: out, headingOverlaps: overlaps, anyHOverflow: out.some((x) => x.overflowsH) };
});
console.log('POP ' + JSON.stringify(r, null, 1));
await browser.disconnect();
