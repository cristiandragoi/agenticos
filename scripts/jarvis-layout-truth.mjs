// CDP layout truth for the Jarvis stage: are the chest core / lower energy
// core / platform / RUNS module actually rendered and where do they sit?
import puppeteer from 'puppeteer-core';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((p) => p.url().includes('file://')) || pages[0];

const info = await app.evaluate(() => {
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) };
  };
  const stage = document.querySelector('[data-testid="jarvis-orb-stage"]');
  const svg = stage ? stage.querySelector('svg') : null;
  const findInSvg = (sel) => {
    // search both the humanoid svg and the systems svg
    const all = document.querySelectorAll('svg');
    for (const s of all) {
      const el = s.querySelector(sel);
      if (el) return el;
    }
    return null;
  };
  const runsText = Array.from(document.querySelectorAll('text')).find((t) => (t.textContent || '').trim() === 'RUNS');
  return {
    vp: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio },
    stage: box(stage),
    humanoidSvg: box(svg),
    foreheadCore: box(findInSvg('#foreheadCore')),
    chestCore: box(findInSvg('#chestCore')),
    lowerEnergyCore: box(findInSvg('#lowerEnergyCore')),
    runsText: box(runsText),
    chestCoreEls: findInSvg('#chestCore') ? findInSvg('#chestCore').children.length : 0,
    svgCount: document.querySelectorAll('svg').length,
  };
});
console.log('LAYOUT ' + JSON.stringify(info));
await browser.disconnect();
