// Find the latest assistant message in the #/jarvis conversation DOM
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const page = pages.find((p) => p.url().startsWith('file:')) || pages[0];
const info = await page.evaluate(() => {
  const body = document.body.innerText;
  const idx = body.lastIndexOf('Laguna');
  const idx2 = body.lastIndexOf('What model are you using?');
  return {
    hash: location.hash,
    hasLaguna: idx >= 0,
    lagunaContext: idx >= 0 ? body.slice(Math.max(0, idx - 400), idx + 200).replace(/\n+/g, ' | ') : '',
    userQPresent: idx2 >= 0,
    bodyLen: body.length,
  };
});
console.log(JSON.stringify(info, null, 1));
await browser.disconnect();
