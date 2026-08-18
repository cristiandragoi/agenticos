// Does the transcript onScroll fire? Does jump-to-latest render?
import puppeteer from 'puppeteer-core';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((p) => p.url().includes('file://')) || pages[0];
await app.evaluate(() => { location.hash = '#/jarvis'; });
await sleep(5000);

const r = await app.evaluate(async () => {
  const sc = document.querySelector('[data-testid="jarvis-chat-scroll"]');
  if (!sc) return { error: 'no scroll' };
  window.__scrollEvents = 0;
  sc.addEventListener('scroll', () => { window.__scrollEvents++; });
  sc.scrollTop = 0;
  await new Promise((res) => setTimeout(res, 1200));
  return {
    scrollEvents: window.__scrollEvents,
    scrollTop: sc.scrollTop,
    scrollH: sc.scrollHeight,
    clientH: sc.clientHeight,
    jump: !!document.querySelector('[data-testid="jarvis-jump-to-latest"]'),
    jumpText: document.querySelector('[data-testid="jarvis-jump-to-latest"]')?.textContent || null,
  };
});
console.log('SCROLL ' + JSON.stringify(r, null, 1));
await browser.disconnect();
