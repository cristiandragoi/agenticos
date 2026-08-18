// Debug: call apiFetch from the page context and check the result + console errors.
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

const consoleErrors = [];
app.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
app.on('pageerror', (e) => consoleErrors.push('PAGEERROR:' + String(e).slice(0, 200)));

// Try fetching from the page directly with the same apiUrl resolution.
const probe = await app.evaluate(async () => {
  const results = {};
  try {
    const r = await fetch('http://127.0.0.1:4600/api/jarvis/runtime-state', { signal: AbortSignal.timeout(3000) });
    const d = await r.json();
    results.directAbsolute = { ok: r.ok, state: d.state };
  } catch (e) { results.directAbsolute = { error: String(e).slice(0, 120) }; }
  try {
    const r = await fetch('/api/jarvis/runtime-state', { signal: AbortSignal.timeout(3000) });
    const d = await r.json();
    results.relative = { ok: r.ok, state: d.state };
  } catch (e) { results.relative = { error: String(e).slice(0, 120) }; }
  return results;
});
console.log('PROBE ' + JSON.stringify(probe));
await sleep(4000);
console.log('ERRORS ' + JSON.stringify(consoleErrors.slice(-8)));
await browser.disconnect();
