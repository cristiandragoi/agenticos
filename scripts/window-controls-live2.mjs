/** Clear stale CDP emulation overrides, then re-run the live window-control test. */
import puppeteer from 'puppeteer-core';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const page = pages.find((p) => p.url().includes('5173')) || pages[0];
const cdp = await page.target().createCDPSession();
await cdp.send('Emulation.clearDeviceMetricsOverride').catch(() => {});
await sleep(1000);

const state = () => page.evaluate(() => ({
  w: window.innerWidth, h: window.innerHeight,
  visibility: document.visibilityState,
}));
const clickBtn = (id) => page.evaluate((btnId) => {
  const b = document.querySelector(`[data-testid="${btnId}"]`);
  if (!b) return false;
  b.click();
  return true;
}, id);

const s0 = await state();
console.log('INITIAL', JSON.stringify(s0));

await clickBtn('titlebar-maximize');
await sleep(1500);
const sMax = await state();
console.log('AFTER-MAXIMIZE', JSON.stringify(sMax));
console.log('MAXIMIZE-WORKS', (sMax.w > s0.w || sMax.h > s0.h));

await clickBtn('titlebar-maximize');
await sleep(1500);
const sRestored = await state();
console.log('AFTER-RESTORE', JSON.stringify(sRestored));
console.log('RESTORE-WORKS', Math.abs(sRestored.w - s0.w) <= 2 && Math.abs(sRestored.h - s0.h) <= 2);

await clickBtn('titlebar-minimize');
await sleep(1800);
let sMin;
try { sMin = await state(); } catch (e) { sMin = { error: String(e.message).slice(0, 80) }; }
console.log('AFTER-MINIMIZE', JSON.stringify(sMin));

await clickBtn('titlebar-maximize');
await sleep(1800);
const sBack = await state();
console.log('AFTER-RESTORE-FROM-MIN', JSON.stringify(sBack));
console.log('MINIMIZE-WORKS', (sMin.visibility === 'hidden' || sMin.error) && sBack.visibility === 'visible');
browser.disconnect();
console.log('WINDOW-CONTROL-TEST-DONE');
