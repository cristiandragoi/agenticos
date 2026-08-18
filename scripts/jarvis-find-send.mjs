// Find the send button near the composer input
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const page = pages.find((p) => p.url().startsWith('file:')) || pages[0];
const info = await page.evaluate(() => {
  const input = document.querySelector('[data-composer-probe]');
  if (!input) return { err: 'no input' };
  // Walk up from the input to find the composer container, then list buttons inside it
  let container = input;
  for (let i = 0; i < 6 && container.parentElement; i++) container = container.parentElement;
  const btns = Array.from(container.querySelectorAll('button')).map((b, idx) => ({
    idx,
    text: (b.innerText || '').trim().slice(0, 40),
    title: (b.getAttribute('title') || '').slice(0, 40),
    aria: (b.getAttribute('aria-label') || '').slice(0, 40),
    cls: (b.className || '').toString().slice(0, 50),
  }));
  return { containerTag: container.tagName, containerCls: (container.className || '').toString().slice(0, 80), btns };
});
console.log(JSON.stringify(info, null, 1));
await browser.disconnect();
