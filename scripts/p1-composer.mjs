// Inspect the composer controls to send reliably.
import puppeteer from 'puppeteer-core';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((p) => p.url().includes('file://')) || pages[0];
await app.evaluate(() => { location.hash = '#/jarvis'; });
await sleep(5000);
const info = await app.evaluate(() => {
  const ta = document.querySelector('textarea');
  const btns = [...document.querySelectorAll('button')].map((b, i) => ({
    i, text: (b.textContent || '').trim().slice(0, 24), aria: b.getAttribute('aria-label') || '', title: b.getAttribute('title') || '',
  })).filter((b) => /send|mic|voice|speak|start|stop|conversation|manual/i.test(b.text + b.aria + b.title)).slice(0, 12);
  return { hasTextarea: !!ta, taPlaceholder: ta?.getAttribute('placeholder'), btns };
});
console.log(JSON.stringify(info, null, 1));
await browser.disconnect();
