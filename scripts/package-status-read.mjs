// One-shot packaged-app UI read over CDP (fresh session per invocation).
// Reads the backend status chip + JARVIS orb; navigates to #/jarvis if the
// orb is not on the current route. Connect -> read -> disconnect only.
import puppeteer from 'puppeteer-core';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((p) => p.url().includes('file://')) || pages[0];

const read = async () =>
  app.evaluate(() => {
    const dot = document.querySelector('[data-testid="backend-status-dot"]');
    const chip = dot ? dot.closest('button') : null;
    const orb = document.querySelector('[data-testid="jarvis-orb"]');
    const orbLabel = document.querySelector('[data-testid="jarvis-orb-label"]');
    return {
      url: location.href,
      backendChip: chip ? chip.innerText.trim() : null,
      orbPresent: !!orb,
      orbState: orb ? orb.getAttribute('data-orb-state') : null,
      orbLabel: orbLabel ? orbLabel.textContent.trim() : null,
    };
  });

let info = await read();
if (!info.orbPresent) {
  await app.evaluate(() => { location.hash = '#/jarvis'; });
  await sleep(6000);
  info = await read();
}
console.log('PACKAGE_UI ' + JSON.stringify(info));
await browser.disconnect();
