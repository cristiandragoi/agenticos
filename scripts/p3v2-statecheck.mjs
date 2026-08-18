// Verify localized state colors in the live DOM (THINKING → purple brain).
import puppeteer from 'puppeteer-core';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((p) => p.url().includes('file://')) || pages[0];
await app.evaluate(() => { location.hash = '#/jarvis-v2-demo'; });
await sleep(5000);

const sample = () => app.evaluate(() => {
  const root = document.querySelector('.jv2-root');
  const g = (id) => {
    const el = root.querySelector(`#${id}`);
    if (!el) return null;
    const first = el.querySelector('circle, path, line, ellipse');
    return first ? first.getAttribute('stroke') || first.getAttribute('fill') : null;
  };
  return {
    state: root?.getAttribute('data-jarvis-state'),
    brain: g('foreheadCore'),
    brainNeurons: g('brainNeurons'),
    face: g('face'),
    leftEye: g('leftEye'),
    chest: g('chestCore'),
  };
});

const out = { idle: await sample() };
await app.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'THINKING'); if (b) b.click(); });
await sleep(1500);
out.thinking = await sample();
await app.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'SPEAKING'); if (b) b.click(); });
await sleep(1500);
out.speaking = await sample();
console.log('RESULT ' + JSON.stringify(out, null, 1));
await browser.disconnect();
