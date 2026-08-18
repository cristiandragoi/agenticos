// Setup for the physical C/D voice test: navigate to #/jarvis, enable the
// golden-path diag (localStorage), open the panel, ensure the voice→golden
// toggle is OFF for turn C.
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const page = pages.find((p) => p.url().startsWith('file:')) || pages[0];

// Enable diag + reload on #/jarvis
await page.evaluate(() => {
  localStorage.setItem('jarvisDiag', '1');
  location.hash = '#/jarvis';
});
await new Promise((r) => setTimeout(r, 1500));
await page.reload();
await page.waitForFunction(() => document.querySelector('[data-testid="golden-path-panel"]'), { timeout: 20000 });

// Open the panel
await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll('[data-testid="golden-path-panel"] button')).find((b) => b.textContent?.includes('GOLDEN PATH DIAG'));
  btn?.click();
});
await page.waitForFunction(() => document.querySelector('[data-testid="golden-path-input"]'), { timeout: 10000 });

// Ensure voice toggle is OFF for turn C
const toggleState = await page.evaluate(() => {
  const cb = document.querySelector('[data-testid="golden-path-voice-toggle"]');
  if (cb && cb.checked) cb.click();
  return cb ? cb.checked : 'MISSING';
});
console.log('VOICE_TOGGLE_AFTER_SETUP:', toggleState);
console.log('PANEL_OPEN: yes');
await browser.disconnect();
