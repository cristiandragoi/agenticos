// Live /jarvis workspace: what activity/events surfaces exist in the DOM?
import puppeteer from 'puppeteer-core';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((p) => p.url().includes('file://')) || pages[0];
await app.goto('file:///B:/AgenticOS/dist/index.html', { waitUntil: 'load' });
await sleep(4000);
await app.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => /Retry connection/i.test(x.textContent || ''));
  if (b) b.click();
});
await sleep(6000);
await app.evaluate(() => { location.hash = '#/jarvis'; });
await sleep(2500);
await app.evaluate(() => {
  const t = [...document.querySelectorAll('button')].find((x) => /SHOW DOCK/i.test(x.textContent || ''));
  if (t) t.click();
});
await sleep(2500);
const out = await app.evaluate(() => {
  const text = document.body.innerText;
  const markers = ['ACTIVE WORK', 'UNDERSTOOD', 'DELEGATED', 'BLOCKED', 'RESULT', 'System Status', 'ACTIVE', 'live', 'event', 'Event'];
  const found = {};
  for (const m of markers) found[m] = text.includes(m);
  // find text-like rows in the dock
  const rows = [...document.querySelectorAll('[class*="dock"] [class*="row"], [class*="Dock"] [class*="row"]')].length;
  return { found, textSnippet: text.slice(0, 1200) };
});
console.log(JSON.stringify(out, null, 1));
await app.screenshot({ path: 'scripts/p3-shots/workspace-current.png' });
await browser.disconnect();
