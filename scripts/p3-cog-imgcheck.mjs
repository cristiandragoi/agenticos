// Locate the <img> elements + confirm they're outside the cognitive stage.
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((p) => p.url().includes('file://')) || pages[0];
await app.evaluate(() => { location.hash = '#/cog-demo'; });
await new Promise((r) => setTimeout(r, 6000));
const out = await app.evaluate(() => {
  const stage = document.querySelector('.jv2-root')?.closest('div[style*="overflow"]');
  const imgs = [...document.querySelectorAll('img')].map((img) => {
    const r = img.getBoundingClientRect();
    const inStage = stage ? !(r.right < stage.getBoundingClientRect().left || r.left > stage.getBoundingClientRect().right || r.bottom < stage.getBoundingClientRect().top || r.top > stage.getBoundingClientRect().bottom) : false;
    return { src: (img.src || '').slice(0, 60), w: Math.round(r.width), h: Math.round(r.height), inStage };
  });
  return { imgs, stageRect: stage ? (() => { const r = stage.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; })() : null };
});
console.log(JSON.stringify(out, null, 1));
await browser.disconnect();
