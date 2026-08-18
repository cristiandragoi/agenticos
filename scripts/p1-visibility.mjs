// Check visibilityState + force a refetch via visibilitychange if hidden.
import puppeteer from 'puppeteer-core';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((p) => p.url().includes('file://')) || pages[0];
const state = await app.evaluate(() => ({
  vis: document.visibilityState,
  hidden: document.hidden,
  hasStudio: !!document.querySelector('[data-testid="jarvis-orb"]'),
}));
console.log('STATE ' + JSON.stringify(state));
// simulate the window becoming visible → DataProvider's visibilitychange handler refetches
if (state.vis === 'hidden') {
  await app.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await sleep(8000);
  const after = await app.evaluate(() => ({
    hasStudio: !!document.querySelector('[data-testid="jarvis-orb"]'),
    bodyHead: (document.body.textContent || '').slice(0, 60),
  }));
  console.log('AFTER VISIBLE ' + JSON.stringify(after));
}
await browser.disconnect();
