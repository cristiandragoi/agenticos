// Diagnose the vectorized render: SVG bbox, path validity, visible elements.
import puppeteer from 'puppeteer-core';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((p) => p.url().includes('file://')) || pages[0];
await app.evaluate(() => { location.hash = '#/jarvis-v2-demo'; });
await sleep(6000);
const info = await app.evaluate(() => {
  const root = document.querySelector('.jv2-root');
  if (!root) return { error: 'no root' };
  const svg = root.querySelector('svg');
  const head = root.querySelector('#headSilhouette path');
  const d = head ? head.getAttribute('d') : null;
  // compute path bbox from the first/last M/C coordinates
  const nums = d ? d.match(/-?[\d.]+/g).map(Number) : [];
  let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
  for (let i = 0; i < nums.length; i += 2) {
    const x = nums[i], y = nums[i + 1];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return {
    svgCount: root.querySelectorAll('svg').length,
    svgViewBox: svg.getAttribute('viewBox'),
    pathLen: d ? d.length : 0,
    pathBBox: { minX, minY, maxX, maxY },
    pathStart: d ? d.slice(0, 60) : null,
    totalCircles: root.querySelectorAll('circle').length,
    totalPaths: root.querySelectorAll('path').length,
  };
});
console.log('INFO ' + JSON.stringify(info, null, 1));
await browser.disconnect();
