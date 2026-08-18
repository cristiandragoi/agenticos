// Check console errors + verify the running bundle matches dist.
import puppeteer from 'puppeteer-core';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((p) => p.url().includes('file://')) || pages[0];
const targets = await browser.targets();
const tgt = targets.find((t) => t.type() === 'page' && t.url().includes('file://'));
const cdp = await tgt.createCDPSession();
await cdp.send('Page.enable');
const errs = [];
app.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text().slice(0, 200)); });
app.on('pageerror', (e) => errs.push('PAGEERROR: ' + String(e).slice(0, 200)));
await app.evaluate(() => { location.hash = '#/jarvis'; });
await sleep(8000);
const info = await app.evaluate(() => {
  const scripts = [...document.querySelectorAll('script[src]')].map((s) => s.src);
  return { scripts, hasJarvisCore: !!document.querySelector('[data-testid="jarvis-orb"]') };
});
console.log('SCRIPTS ' + JSON.stringify(info.scripts));
console.log('ERRORS ' + JSON.stringify(errs.slice(-10)));
await browser.disconnect();
