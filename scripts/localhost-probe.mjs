// Test apiUrl resolution + whether the dist bundle has the runtime-state poll.
import puppeteer from 'puppeteer-core';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((p) => p.url().includes('file://')) || pages[0];
const targets = await browser.targets();
const tgt = targets.find((t) => t.type() === 'page' && t.url().includes('file://'));
const cdp = await tgt.createCDPSession();
await cdp.send('Page.enable');
await app.evaluate(() => { location.hash = '#/jarvis'; });
await sleep(6000);
const probe = await app.evaluate(async () => {
  const r = await fetch('http://localhost:4600/api/jarvis/runtime-state', { signal: AbortSignal.timeout(3000) });
  const d = await r.json();
  return { ok: r.ok, state: d.state };
});
console.log('LOCALHOST_PROBE ' + JSON.stringify(probe));
await browser.disconnect();
