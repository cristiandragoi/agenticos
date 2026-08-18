// Probe: is the golden-path panel in the DOM? What's the current view state?
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const page = pages.find((p) => p.url().startsWith('file:')) || pages[0];
const info = await page.evaluate(() => {
  const panel = document.querySelector('[data-testid="golden-path-panel"]');
  const composer = document.querySelector('[data-testid="jarvis-sticky-composer"]');
  const inputs = Array.from(document.querySelectorAll('input, textarea')).slice(0, 8).map((el) => ({
    tag: el.tagName, ph: el.getAttribute('placeholder'), testid: el.getAttribute('data-testid'),
    cls: (el.className || '').toString().slice(0, 40),
  }));
  return {
    hash: location.hash,
    panel: panel ? 'PRESENT' : 'ABSENT',
    panelDisplay: panel ? getComputedStyle(panel).display : 'n/a',
    composer: composer ? getComputedStyle(composer).display : 'ABSENT',
    inputs,
    bodyHead: document.body.innerText.slice(0, 300).replace(/\n/g, ' | '),
  };
});
console.log(JSON.stringify(info, null, 1));
await browser.disconnect();
