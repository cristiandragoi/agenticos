// One-shot CDP read of the renderer loaded by THIS process.
// Reads: URL, title, script assets, body text sample, presence of the old
// error strings, status chip, orb. Fresh session per invocation.
import puppeteer from 'puppeteer-core';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((p) => p.url().includes('file://')) || pages[0];
await sleep(1500);

const info = await app.evaluate(() => {
  const scripts = [...document.querySelectorAll('script[src]')].map((s) => s.src);
  const dot = document.querySelector('[data-testid="backend-status-dot"]');
  const chip = dot ? dot.closest('button') : null;
  const orb = document.querySelector('[data-testid="jarvis-orb"]');
  const orbLabel = document.querySelector('[data-testid="jarvis-orb-label"]');
  const body = (document.body ? document.body.innerText : '');
  return {
    url: location.href,
    title: document.title,
    scripts,
    bodyStart: body.slice(0, 300),
    hasOldBanner: body.includes('Backend Disconnected'),
    hasOldFetch: body.includes('Failed to fetch data from localhost:4000'),
    backendChip: chip ? chip.innerText.trim() : null,
    orbPresent: !!orb,
    orbLabel: orbLabel ? orbLabel.textContent.trim() : null,
  };
});
console.log('RENDERER ' + JSON.stringify(info));
await browser.disconnect();
