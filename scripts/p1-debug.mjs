// Debug: what's on #/jarvis — dock toggle, errors, page state.
import puppeteer from 'puppeteer-core';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((p) => p.url().includes('file://')) || pages[0];
await app.setViewport({ width: 1920, height: 1080 });
await app.evaluate(() => { location.hash = '#/jarvis'; });
await sleep(9000);
const info = await app.evaluate(() => {
  const btns = [...document.querySelectorAll('button')].map((b) => (b.textContent || '').trim().slice(0, 30));
  return {
    hash: location.hash,
    bodyText: (document.body.textContent || '').slice(0, 300),
    buttons: btns.slice(0, 25),
    hasStudio: !!document.querySelector('[data-testid="jarvis-orb"]'),
    hasInsights: !!document.querySelector('[data-testid="jarvis-insights"]'),
    hasComposer: !!document.querySelector('[data-testid="jarvis-composer-textarea"], textarea'),
    errorEls: [...document.querySelectorAll('[class*="error"], [class*="Error"]')].map((e) => e.textContent?.slice(0, 80)).slice(0, 3),
  };
});
console.log(JSON.stringify(info, null, 1));
await app.screenshot({ path: 'scripts/p1-debug.png' });
console.log('screenshot saved scripts/p1-debug.png');
await browser.disconnect();
