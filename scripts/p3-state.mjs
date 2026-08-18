// What does the chat transcript actually show + what routing happened?
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
await app.evaluate(() => { location.hash = '#/jarvis'; });
await sleep(2500);
await app.evaluate(() => {
  const t = [...document.querySelectorAll('button')].find((x) => /SHOW DOCK/i.test(x.textContent || ''));
  if (t) t.click();
});
await sleep(1500);
const out = await app.evaluate(() => {
  const text = document.body.innerText;
  const hasAtlas = text.includes('Atlas');
  const sc = document.querySelector('[data-testid="jarvis-chat-scroll"]');
  const codexPanel = text.includes('Open in CodeX Studio');
  // find the transcript section
  const tr = text.indexOf('TRANSCRIPT');
  const lw = text.indexOf('LIVE WORK');
  return {
    hasAtlas,
    scrollFound: !!sc,
    scrollTextLen: sc ? sc.innerText.length : 0,
    scrollTail: sc ? sc.innerText.split('\n').slice(-12) : [],
    codexPanelVisible: codexPanel,
    transcriptSection: tr >= 0 ? text.slice(tr, tr + 600).replace(/\n/g, ' | ') : 'NO TRANSCRIPT SECTION',
    liveWork: lw >= 0 ? text.slice(lw, lw + 200).replace(/\n/g, ' | ') : '',
  };
});
console.log(JSON.stringify(out, null, 1));
await browser.disconnect();
