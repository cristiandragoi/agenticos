// Read current app state + recent conversation rows to see the echo self-loop.
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((p) => p.url().includes('file://')) || pages[0];
const st = await app.evaluate(() => {
  const rows = Array.from(document.querySelectorAll('[data-testid="jarvis-command-line"]')).map((l) => l.innerText.replace(/\s+/g, ' ').trim());
  const primary = document.querySelector('[data-testid="jarvis-primary-control"]');
  return { rows: rows.slice(-20), primary: primary ? primary.innerText.trim() : null };
});
console.log(JSON.stringify(st, null, 1));
await browser.disconnect();
