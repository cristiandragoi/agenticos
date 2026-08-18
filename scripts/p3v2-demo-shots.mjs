// Standalone visual-gate screenshots: ONE JarvisV2 humanoid in IDLE /
// THINKING / SPEAKING (one per state, never simultaneous).
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DIR = 'scripts/p3-shots/jarvis-v2';
fs.mkdirSync(DIR, { recursive: true });

const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((p) => p.url().includes('file://')) || pages[0];
await app.evaluate(() => { location.hash = '#/jarvis-v2-demo'; });
await sleep(6000);

const result = {};
const clickState = async (label) => {
  await app.evaluate((l) => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === l);
    if (btn) btn.click();
  }, label);
  await sleep(1500);
};
const snap = async (name) => {
  await app.screenshot({ path: `${DIR}/${name}.png`, fullPage: false });
  result[name] = `${DIR}/${name}.png`;
};

// IDLE (default state)
await snap('idle');
result.idleState = await app.evaluate(() => document.querySelector('.jv2-root')?.getAttribute('data-jarvis-state'));

// THINKING
await clickState('THINKING');
await snap('thinking');
result.thinkingState = await app.evaluate(() => document.querySelector('.jv2-root')?.getAttribute('data-jarvis-state'));

// SPEAKING
await clickState('SPEAKING');
await snap('speaking');
result.speakingState = await app.evaluate(() => document.querySelector('.jv2-root')?.getAttribute('data-jarvis-state'));

// sanity: exactly ONE humanoid + region ids present
result.dom = await app.evaluate(() => {
  const root = document.querySelector('.jv2-root');
  return {
    humanoidSvgs: root ? root.querySelectorAll('svg').length : 0,
    regions: ['headSilhouette', 'leftEye', 'rightEye', 'face', 'foreheadCore', 'brainNeurons', 'faceNeurons', 'neck', 'torso', 'chestCore', 'lowerEnergyCore']
      .map((id) => `${id}:${!!root.querySelector(`#${id}`)}`),
    imgCount: root ? root.querySelectorAll('img').length : -1,
  };
});

console.log('RESULT ' + JSON.stringify(result, null, 1));
console.log('DOM ' + JSON.stringify(result.dom));
await browser.disconnect();
