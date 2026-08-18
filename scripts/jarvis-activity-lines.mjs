// Read the Jarvis activity stream line rows.
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((p) => p.url().includes('file://')) || pages[0];
const rows = await app.evaluate(() =>
  Array.from(document.querySelectorAll('[data-testid="jarvis-activity-line"]')).map((l) => l.innerText.replace(/\s+/g, ' ').trim()).slice(-16),
);
console.log('ACT_ROWS ' + JSON.stringify(rows));
await browser.disconnect();
