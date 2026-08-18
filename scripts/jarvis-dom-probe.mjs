// Inspect the live app DOM: find Jarvis chat message containers and any
// voice-trace stage UI. Read-only.
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const page = pages.find((p) => p.url().startsWith('file:')) || pages[0];
await page.evaluate(() => {
  window.__domProbe = true;
});
const info = await page.evaluate(() => {
  const out = { url: location.href, textLen: document.body.innerText.length };
  // Find elements whose text contains likely message content
  const candidates = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  const seen = new Set();
  while (walker.nextNode()) {
    const el = walker.currentNode;
    if (seen.has(el)) continue;
    const cls = typeof el.className === 'string' ? el.className : '';
    const text = (el.innerText || '').trim();
    if (text.length > 0 && text.length < 400 && /assistant|user|message|jarvis/i.test(cls)) {
      const tag = el.tagName.toLowerCase();
      const path = tag + '.' + cls.split(/\s+/).slice(0, 2).join('.');
      candidates.push({ path, text: text.slice(0, 80) });
      seen.add(el);
      if (candidates.length > 30) break;
    }
  }
  out.candidates = candidates;
  return out;
});
console.log('URL:', info.url);
console.log('BODY_TEXT_LEN:', info.textLen);
for (const c of info.candidates) console.log('EL:', c.path, '|', JSON.stringify(c.text));
await browser.disconnect();
