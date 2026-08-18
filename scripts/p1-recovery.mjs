// Wait for the DataProvider's 60s interval to refetch; confirm recovery.
import puppeteer from 'puppeteer-core';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((p) => p.url().includes('file://')) || pages[0];
let recovered = false;
for (let i = 0; i < 28; i++) {
  const has = await app.evaluate(() => !!document.querySelector('[data-testid="jarvis-orb"]'));
  if (has) { recovered = true; console.log('RECOVERED after ~' + i * 3 + 's'); break; }
  await sleep(3000);
}
if (!recovered) console.log('NOT RECOVERED after 84s');
await browser.disconnect();
