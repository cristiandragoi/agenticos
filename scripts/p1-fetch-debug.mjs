// Does the page's own fetch reach the backend? Click retry + sample.
import puppeteer from 'puppeteer-core';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((p) => p.url().includes('file://')) || pages[0];
const fetchTest = await app.evaluate(async () => {
  try {
    const r = await fetch('http://localhost:4000/api/agents', { method: 'GET' });
    return { ok: r.ok, status: r.status, len: (await r.text()).length };
  } catch (e) {
    return { err: String(e) };
  }
});
console.log('PAGE FETCH: ' + JSON.stringify(fetchTest));

const before = await app.evaluate(() => ({
  retryBtn: [...document.querySelectorAll('button')].find((b) => /Retry connection/i.test(b.textContent || '')) ? 'found' : 'missing',
}));
console.log('BEFORE: ' + JSON.stringify(before));
await app.evaluate(() => {
  const retry = [...document.querySelectorAll('button')].find((b) => /Retry connection/i.test(b.textContent || ''));
  if (retry) retry.click();
});
await sleep(5000);
const after = await app.evaluate(() => ({
  hasStudio: !!document.querySelector('[data-testid="jarvis-orb"]'),
  hasInsights: !!document.querySelector('[data-testid="jarvis-insights"]'),
  bodyHead: (document.body.textContent || '').slice(0, 80),
}));
console.log('AFTER: ' + JSON.stringify(after));
await browser.disconnect();
