// Extract the voice-trace panel DOM (stages, statuses, first failure) + the
// composer/mic area text from the live #/jarvis page.
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const page = pages.find((p) => p.url().startsWith('file:')) || pages[0];
const info = await page.evaluate(() => {
  const out = {};
  const body = document.body.innerText;
  // Find the element containing 'VOICE TRACE' and dump its text
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  let traceEl = null;
  while (walker.nextNode()) {
    const el = walker.currentNode;
    const t = (el.innerText || '');
    if (t.includes('VOICE TRACE') && t.length < 4000) { traceEl = el; break; }
  }
  out.tracePanel = traceEl ? traceEl.innerText : '(not found)';
  // Composer area: find 'Listening'/'Send' region
  const idx = body.indexOf('Listening');
  out.composerArea = body.slice(Math.max(0, idx - 300), idx + 300).replace(/\n+/g, ' | ');
  return out;
});
console.log('=== VOICE TRACE PANEL ===');
console.log(info.tracePanel);
console.log('\n=== COMPOSER AREA ===');
console.log(info.composerArea);
await browser.disconnect();
