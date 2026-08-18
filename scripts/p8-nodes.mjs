// P8: click every neural node, verify the route navigates.
import puppeteer from 'puppeteer-core';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((p) => p.url().includes('file://')) || pages[0];
await app.goto('file:///B:/AgenticOS/dist/index.html', { waitUntil: 'load' });
await sleep(4000);
await app.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => /Retry connection/i.test(x.textContent || ''));
  if (b) b.click();
});
await sleep(6000);

const NODES = [
  ['MEMORY', '#/memory'], ['PROJECTS', '#/mission-control'], ['KNOWLEDGE', '#/research'],
  ['ARTIFACTS', '#/builds'], ['HERMES', '#/hermes-studio'], ['CODEX', '#/codex'],
  ['RUNS', '#/runs'], ['VISION', '#/video'],
];
const results = [];
for (const [label, expected] of NODES) {
  await app.evaluate(() => { location.hash = '#/jarvis'; });
  await sleep(2200);
  const got = await app.evaluate((l) => {
    const n = document.querySelector(`.jhv-node[aria-label="${l}"]`);
    if (!n) return { label: l, found: false };
    n.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    return { label: l, found: true };
  }, label);
  await sleep(1500);
  const hash = await app.evaluate(() => location.hash);
  results.push({ label, found: got.found, hash, ok: hash === expected });
}
console.log(JSON.stringify(results, null, 1));
await browser.disconnect();
