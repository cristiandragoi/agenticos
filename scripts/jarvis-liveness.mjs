// Live runtime liveness probe:
// 1) document visibility (hidden windows throttle requestAnimationFrame)
// 2) is requestAnimationFrame actually firing in this page right now?
// 3) Electron window bounds/state via CDP
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const page = pages.find((p) => p.url().startsWith('file:')) || pages[0];

const vis = await page.evaluate(() => ({
  hidden: document.hidden,
  visibilityState: document.visibilityState,
  hasFocus: document.hasFocus(),
}));

// rAF liveness: count frames over 2s
await page.evaluate(() => {
  window.__rafProbe = 0;
  const f = () => { window.__rafProbe += 1; window.requestAnimationFrame(f); };
  window.requestAnimationFrame(f);
});
await new Promise((r) => setTimeout(r, 2000));
const raf = await page.evaluate(() => ({ frames: window.__rafProbe }));

// Also probe setInterval liveness (polling still works?)
await page.evaluate(() => {
  window.__intProbe = 0;
  window.__intId = setInterval(() => { window.__intProbe += 1; }, 500);
});
await new Promise((r) => setTimeout(r, 2000));
const intv = await page.evaluate(() => { clearInterval(window.__intId); return { ticks: window.__intProbe }; });

console.log('VISIBILITY:', JSON.stringify(vis));
console.log('RAF_FRAMES_2S:', raf.frames);
console.log('INTERVAL_TICKS_2S:', intv.ticks);

// Electron window bounds via CDP
try {
  const { targetId } = await page.target()._targetInfo || {};
  const win = await (page.target()._client ? null : null);
} catch (e) { /* ignore */ }
try {
  const cdp = await page.createCDPSession();
  const { windowId } = await cdp.send('Browser.getWindowForTarget');
  const { bounds } = await cdp.send('Browser.getWindowBounds', { windowId });
  console.log('WINDOW_BOUNDS:', JSON.stringify(bounds));
} catch (e) {
  console.log('WINDOW_BOUNDS_ERR:', String(e.message).slice(0, 120));
}
await browser.disconnect();
