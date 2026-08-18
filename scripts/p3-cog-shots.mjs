// CognitiveField verification renders: idle bust, thinking + memory node,
// speaking. One humanoid, canvas overlay.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DIR = 'scripts/p3-shots/cognitive-field';
fs.mkdirSync(DIR, { recursive: true });

const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((p) => p.url().includes('file://')) || pages[0];
await app.setViewport({ width: 1600, height: 1000 });
await app.evaluate(() => { location.hash = '#/cog-demo'; });
await sleep(8000);

const clickBtn = async (label) => {
  await app.evaluate((l) => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === l);
    if (b) b.click();
  }, label);
  await sleep(1200);
};

const out = {};
// IDLE bust
await app.screenshot({ path: `${DIR}/idle-bust.png` });
out.idle = `${DIR}/idle-bust.png`;
out.idleState = await app.evaluate(() => document.querySelector('.jv2-root')?.getAttribute('data-jarvis-state'));

// THINKING + memory node (materialize → wait for ACTIVE)
await clickBtn('thinking');
await clickBtn('memory');
await sleep(2000); // past materializing (950ms)
await app.screenshot({ path: `${DIR}/thinking-memory-node.png` });
out.thinking = `${DIR}/thinking-memory-node.png`;
out.thinkingState = await app.evaluate(() => document.querySelector('.jv2-root')?.getAttribute('data-jarvis-state'));

// resolve all + SPEAKING
await clickBtn('resolve all');
await clickBtn('speaking');
await sleep(1200);
await app.screenshot({ path: `${DIR}/speaking.png` });
out.speaking = `${DIR}/speaking.png`;

// structural checks: ONE humanoid, overlay canvas present, no raster
out.dom = await app.evaluate(() => {
  const svg = document.querySelector('.jv2-root svg');
  const canvas = document.querySelector('canvas');
  const imgs = document.querySelectorAll('img').length;
  const stage = document.querySelector('.jv2-root')?.closest('div')?.parentElement;
  return {
    humanoidSvgs: document.querySelectorAll('.jv2-root svg').length,
    overlayCanvas: !!canvas,
    canvasSize: canvas ? `${canvas.width}x${canvas.height}` : null,
    imgCount: imgs,
    stageW: stage ? stage.getBoundingClientRect().width : null,
    stageH: stage ? stage.getBoundingClientRect().height : null,
  };
});
console.log('RESULT ' + JSON.stringify(out, null, 1));
await browser.disconnect();
