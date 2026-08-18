// Full visible transcript rows + orb state from the running app.
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((p) => p.url().includes('file://')) || pages[0];
const out = await app.evaluate(() => {
  const rows = Array.from(document.querySelectorAll('[data-testid="jarvis-command-line"]')).map((l) => l.innerText.replace(/\s+/g, ' ').trim());
  const orb = document.querySelector('[data-testid="jarvis-orb"]');
  const orbState = orb ? orb.getAttribute('data-orb-state') || orb.getAttribute('data-state') : null;
  const primary = document.querySelector('[data-testid="jarvis-primary-control"]');
  const ta = document.querySelector('textarea[aria-label="Message Input"]');
  return {
    rowCount: rows.length,
    rows: rows.slice(-18),
    orbState,
    primaryLabel: primary ? primary.innerText.trim() : null,
    taDisabled: ta ? ta.disabled : null,
  };
});
console.log('FULL_ROWS ' + JSON.stringify(out, null, 1));
await browser.disconnect();
