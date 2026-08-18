// Verify: (1) normal UI restored — golden-path panel ABSENT by default,
// (2) composer + neural blob canvas present on #/jarvis.
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const page = pages.find((p) => p.url().startsWith('file:')) || pages[0];
await page.evaluate(() => { location.hash = '#/jarvis'; });
await new Promise((r) => setTimeout(r, 2500));
const info = await page.evaluate(() => {
  const panel = document.querySelector('[data-testid="golden-path-panel"]');
  const composer = document.querySelector('[data-testid="jarvis-sticky-composer"]');
  const inputs = Array.from(document.querySelectorAll('input, textarea')).filter((el) => (el.getAttribute('placeholder') || '').includes('Ask Jarvis'));
  const canvases = document.querySelectorAll('canvas').length;
  const orbText = document.body.innerText.includes('LISTENING') || document.body.innerText.includes('Listening');
  return {
    hash: location.hash,
    goldenPanel: panel ? 'PRESENT (BAD)' : 'ABSENT (good — hidden by default)',
    composerDisplay: composer ? getComputedStyle(composer).display : 'ABSENT',
    jarvisInputs: inputs.length,
    canvasCount: canvases,
    orbListening: orbText,
    bodyLen: document.body.innerText.length,
  };
});
console.log(JSON.stringify(info, null, 1));
await browser.disconnect();
