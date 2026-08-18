// P7 clean: enter conversation mode, watch states + voice trace for 18s.
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
// expand voice trace
await app.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => /VOICE TRACE/i.test(x.textContent || '') && /SHOW/i.test(x.textContent || ''));
  if (b) b.click();
});
await sleep(1000);
// enter conversation mode
await app.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => /START CONVERSATION/i.test((x.textContent || '').trim()));
  if (b) b.click();
});
const snap = async (tag) => {
  const s = await app.evaluate(() => {
    const text = document.body.innerText;
    const mic = text.split('\n');
    const mi = mic.findIndex((l) => l === 'MIC');
    const vi = text.indexOf('VOICE TRACE');
    return {
      micLine: mi >= 0 ? mic.slice(mi, mi + 2).join(' ') : null,
      trace: text.slice(vi, vi + 300).replace(/\n/g, ' | '),
    };
  });
  console.log(tag + ' ' + JSON.stringify(s));
};
for (let i = 0; i < 6; i++) { await sleep(3000); await snap('t+' + (i + 1) * 3 + 's'); }
await browser.disconnect();
