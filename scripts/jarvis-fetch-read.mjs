// Read back the captured transcribe fetch records from the running renderer.
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const page = pages.find((p) => p.url().startsWith('file:')) || pages[0];
const data = await page.evaluate(() => window.__vtFetch || []);
console.log('RECORDS:', data.length);
for (const r of data.slice(-8)) {
  console.log(JSON.stringify(r));
}
await browser.disconnect();
