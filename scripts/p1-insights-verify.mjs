// P1 verification: insights grid at 1920/1600/1366 — no heading overlap,
// all 7 cells present, readable sizes.
import puppeteer from 'puppeteer-core';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((p) => p.url().includes('file://')) || pages[0];

const check = async (w, h) => {
  await app.evaluate(() => { location.hash = '#/jarvis'; });
  await sleep(8000);
  // if the startup-race "Backend unavailable" screen shows (backend was still
  // booting when the registry fetch ran), use the app's retry path
  await app.evaluate(() => {
    const retry = [...document.querySelectorAll('button')].find((b) => /Retry connection/i.test(b.textContent || ''));
    if (retry) retry.click();
  });
  await sleep(4000);
  // ensure dock is open
  await app.evaluate(() => {
    const t = [...document.querySelectorAll('button')].find((b) => /SHOW DOCK/i.test(b.textContent || ''));
    if (t) t.click();
  });
  await sleep(1200);
  const r = await app.evaluate(() => {
    const panel = document.querySelector('[data-testid="jarvis-insights"]');
    if (!panel) return { error: 'no insights panel' };
    const cells = [...panel.querySelectorAll('[data-insight]')];
    const heads = cells.map((c) => c.firstElementChild);
    const overlaps = [];
    for (let i = 0; i < heads.length; i++) {
      for (let j = i + 1; j < heads.length; j++) {
        const a = heads[i].getBoundingClientRect();
        const b = heads[j].getBoundingClientRect();
        const hOverlap = a.left < b.right && b.left < a.right;
        const vOverlap = a.top < b.bottom && b.top < a.bottom;
        if (hOverlap && vOverlap) overlaps.push([i, j]);
      }
    }
    const gridStyle = getComputedStyle(panel);
    return {
      cellCount: cells.length,
      cols: gridStyle.gridTemplateColumns.split(' ').length,
      template: gridStyle.gridTemplateColumns,
      overlaps,
      cellWidths: cells.map((c) => Math.round(c.getBoundingClientRect().width)),
      panelWidth: Math.round(panel.getBoundingClientRect().width),
    };
  });
  console.log(`\n=== ${w}x${h} ===\n` + JSON.stringify(r, null, 1));
};

for (const [w, h] of [[1920, 1080], [1600, 900], [1366, 768]]) {
  await app.setViewport({ width: w, height: h });
  await check(w, h);
}
await browser.disconnect();
