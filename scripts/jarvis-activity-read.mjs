// Read the Jarvis activity stream rows (REQUEST RECEIVED / RESPONSE COMPLETE).
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((p) => p.url().includes('file://')) || pages[0];
const s = await app.evaluate(() => {
  const stream = document.querySelector('[data-testid="jarvis-activity-stream"]');
  const text = stream ? stream.innerText : null;
  const containers = Array.from(document.querySelectorAll('[data-testid]'))
    .map((el) => el.getAttribute('data-testid'))
    .filter((t) => t && t.includes('activity'));
  return { text: text ? text.slice(0, 600) : null, activityTestids: [...new Set(containers)].slice(0, 10) };
});
console.log('ACTIVITY ' + JSON.stringify(s));
await browser.disconnect();
