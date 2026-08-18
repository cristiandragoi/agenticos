// What's on #/jarvis right now?
import puppeteer from 'puppeteer-core';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((p) => p.url().includes('file://')) || pages[0];
await app.evaluate(() => { location.hash = '#/jarvis'; });
await sleep(5000);
const out = await app.evaluate(() => {
  const btns = [...document.querySelectorAll('button')].map((b) => (b.textContent || '').trim()).filter(Boolean).slice(0, 10);
  const scroll = document.querySelector('[data-testid="jarvis-chat-scroll"]');
  const ta = document.querySelector('textarea');
  return { btns, scrollFound: !!scroll, textarea: !!ta, hash: location.hash };
});
console.log(JSON.stringify(out, null, 1));
await browser.disconnect();
