// P7 exit path: the MANUAL/CONVERSATION dock toggle.
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
await sleep(2000);
// enter conversation mode
await app.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => /START CONVERSATION/i.test((x.textContent || '').trim()));
  if (b) b.click();
});
await sleep(2000);
const inConv = await app.evaluate(() => {
  const text = document.body.innerText;
  const lines = text.split('\n');
  const i = lines.findIndex((l) => l === 'CONVERSATION');
  return { convChip: i >= 0 ? lines.slice(Math.max(0, i - 1), i + 2) : null, primary: ([...document.querySelectorAll('button')].find((x) => /START CONVERSATION|END CONVERSATION|LISTENING/i.test((x.textContent || '').trim())) || {}).textContent };
});
console.log('INCONV ' + JSON.stringify(inConv));
// click the CONVERSATION chip (mode toggle) to exit
const exit = await app.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === 'CONVERSATION');
  if (b) { b.click(); return 'clicked'; }
  return 'not-found';
});
console.log('EXIT ' + exit);
await sleep(2000);
const after = await app.evaluate(() => {
  const primary = [...document.querySelectorAll('button')].find((x) => /START CONVERSATION|END CONVERSATION|LISTENING/i.test((x.textContent || '').trim()));
  const mic = document.body.innerText.split('\n');
  const i = mic.findIndex((l) => l === 'MIC');
  return { primary: primary ? primary.textContent.trim() : null, micLine: i >= 0 ? mic.slice(i, i + 2).join(' ') : null };
});
console.log('AFTEREXIT ' + JSON.stringify(after));
await browser.disconnect();
