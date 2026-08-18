// Live UI probe: current stage panel state + conversation tail on #/jarvis.
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const page = pages.find((p) => p.url().startsWith('file:')) || pages[0];
const state = await page.evaluate(() => {
  const body = document.body.innerText;
  const idx = body.indexOf('JARVIS');
  const region = idx >= 0 ? body.slice(idx, idx + 900) : body.slice(0, 900);
  const fetchRecs = (window.__vtFetch || []).length;
  return { hash: location.hash, region, fetchRecs };
});
console.log('HASH:', state.hash);
console.log('REGION:', JSON.stringify(state.region));
console.log('FETCH_RECORDS:', state.fetchRecs);
await browser.disconnect();
