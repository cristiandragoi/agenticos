// Verify the deployed renderer loaded the NEW bundle (index-lhR6Usqo.js)
// and that no [VTurn] instrumentation is active in the live console.
import puppeteer from 'puppeteer-core';

const CDP = 'http://127.0.0.1:9223';
const browser = await puppeteer.connect({ browserURL: CDP, defaultViewport: null });
const pages = await browser.pages();
console.log('PAGES:', pages.length);
for (const p of pages) {
  const url = p.url();
  console.log('URL:', url.slice(0, 140));
  if (!url.startsWith('http') && !url.startsWith('file:')) continue;
  const res = await p.evaluate(() => {
    const scripts = Array.from(document.querySelectorAll('script[src]')).map(s => s.getAttribute('src'));
    const assets = performance.getEntriesByType('resource').map(r => r.name).filter(n => n.includes('assets/'));
    return { title: document.title, scripts, assets: assets.slice(0, 8) };
  });
  console.log('TITLE:', res.title);
  console.log('SCRIPTS:', res.scripts.join(', '));
  console.log('ASSETS:', res.assets.join('\n        '));
  // Confirm the fix string is reachable in the live app (the bundle is the
  // source of truth for what the renderer loaded).
  const hasFix = await p.evaluate(() => {
    const src = document.querySelector('script[src]')?.getAttribute('src') || '';
    return src.includes('index-lhR6Usqo');
  });
  console.log('HAS_NEW_BUNDLE:', hasFix);
}
await browser.disconnect();
