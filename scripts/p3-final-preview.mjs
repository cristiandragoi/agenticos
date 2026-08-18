// Render the pulled JARVIS-Final preview + verify it's a real cyan humanoid.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync('scripts/p3-shots', { recursive: true });
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((p) => p.url().includes('file://')) || pages[0];
await app.setViewport({ width: 1280, height: 900 });
await app.goto('file:///B:/AgenticOS/Humanoid-JARVIS-Final/preview/index.html', { waitUntil: 'load' });
await sleep(5000);
const shot = 'scripts/p3-shots/jarvis-final-preview.png';
await app.screenshot({ path: shot, fullPage: false });
const info = await app.evaluate(() => {
  const svgs = [...document.querySelectorAll('svg')];
  return {
    title: document.title,
    svgCount: svgs.length,
    regionIds: (() => {
      const ids = ['head', 'faceContour', 'leftEye', 'rightEye', 'brain', 'foreheadCore', 'faceNeurons', 'neck', 'torso', 'chestNeurons', 'chestCore', 'nose', 'mouth', 'chin', 'ears', 'particleField'];
      return ids.filter((id) => !!document.getElementById(id)).length + '/' + ids.length;
    })(),
    imgCount: document.querySelectorAll('img').length,
  };
});
console.log('SHOT ' + shot);
console.log('INFO ' + JSON.stringify(info, null, 1));
await browser.disconnect();
