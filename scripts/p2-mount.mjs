// Poll scrollTop after fresh mount — does the transcript settle at bottom?
import puppeteer from 'puppeteer-core';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((p) => p.url().includes('file://')) || pages[0];
await app.evaluate(() => { location.hash = '#/jarvis'; });
for (let i = 0; i < 12; i++) {
  await sleep(2000);
  const s = await app.evaluate((ti) => {
    const sc = document.querySelector('[data-testid="jarvis-chat-scroll"]');
    if (!sc) return { t: ti, err: 'no scroll' };
    return {
      t: ti,
      scrollTop: Math.round(sc.scrollTop),
      scrollH: sc.scrollHeight,
      clientH: sc.clientHeight,
      atBottom: sc.scrollHeight - sc.scrollTop - sc.clientHeight < 140,
      lines: sc.querySelectorAll('[data-testid="jarvis-command-line"]').length,
    };
  }, i * 2);
  console.log(JSON.stringify(s));
  if (s.atBottom) break;
}
await browser.disconnect();
