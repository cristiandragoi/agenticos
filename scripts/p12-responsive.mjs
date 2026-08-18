// P12: responsive regression at 1920/1600/1366 — no overlap, controls reachable.
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

const SIZES = [[1920, 1080], [1600, 900], [1366, 768]];
for (const [w, h] of SIZES) {
  await app.setViewport({ width: w, height: h });
  await app.evaluate(() => { location.hash = '#/jarvis'; });
  await sleep(2500);
  await app.evaluate(() => {
    const t = [...document.querySelectorAll('button')].find((x) => /SHOW DOCK/i.test(x.textContent || ''));
    if (t) t.click();
  });
  await sleep(1800);
  const out = await app.evaluate(() => {
    const docScroll = document.documentElement.scrollHeight - document.documentElement.clientHeight;
    // overlap check: insights cells must not overlap
    const cells = [...document.querySelectorAll('[data-insight]')];
    let overlaps = 0;
    for (let i = 0; i < cells.length; i++) {
      for (let j = i + 1; j < cells.length; j++) {
        const a = cells[i].getBoundingClientRect(), b = cells[j].getBoundingClientRect();
        if (!(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top)) overlaps++;
      }
    }
    const composer = document.querySelector('textarea');
    const send = [...document.querySelectorAll('button')].find((x) => x.getAttribute('aria-label') === 'Send Message');
    return {
      docScrolls: docScroll > 2,
      insightCells: cells.length,
      cellOverlaps: overlaps,
      composerVisible: !!composer && composer.getBoundingClientRect().height > 0,
      sendVisible: !!send && send.getBoundingClientRect().width > 0,
      bodyText: document.body.innerText.slice(0, 60).replace(/\n/g, ' '),
    };
  });
  console.log(w + 'x' + h + ' ' + JSON.stringify(out));
}
await browser.disconnect();
