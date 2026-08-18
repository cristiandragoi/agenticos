// P6 audit: VOICE TRACE panel + VOICE ON toggle + mic state transitions.
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

const snap = async (tag) => {
  const s = await app.evaluate(() => {
    const text = document.body.innerText;
    const vtIdx = text.indexOf('VOICE TRACE');
    const micChip = [...document.querySelectorAll('*')].filter((el) => el.children.length === 0 && /manual|listening|transcribing|speaking/.test(el.textContent || '')).map((el) => el.textContent.trim()).filter(Boolean).slice(0, 8);
    return { trace: text.slice(vtIdx, vtIdx + 700), chips: micChip };
  });
  console.log('--- ' + tag + ' ---');
  console.log(s.trace.replace(/\n/g, ' | ').slice(0, 500));
  console.log('CHIPS ' + JSON.stringify(s.chips));
};

// expand VOICE TRACE if collapsed
await app.evaluate(() => {
  const t = [...document.querySelectorAll('button')].find((x) => /VOICE TRACE/i.test(x.textContent || '') && /SHOW/i.test(x.textContent || ''));
  if (t) t.click();
});
await sleep(1200);
await snap('before toggle');

// find + click the VOICE ON toggle (or OFF)
const toggleResult = await app.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => /VOICE (ON|OFF)/i.test((x.textContent || '').trim()));
  if (b) { b.click(); return b.textContent.trim(); }
  return null;
});
console.log('TOGGLE ' + JSON.stringify(toggleResult));
await sleep(3000);
await snap('after toggle');

// try toggling back
await app.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => /VOICE (ON|OFF)/i.test((x.textContent || '').trim()));
  if (b) b.click();
});
await sleep(2000);
await snap('toggled back');

// console errors?
const errors = await app.evaluate(() => window.__p6Errors || 'n/a');
console.log('CONSOLEERR n/a');
await browser.disconnect();
