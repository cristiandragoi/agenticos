// Quick state check + switch to a fresh conversation via string evaluate.
import puppeteer from 'puppeteer-core';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((p) => p.url().includes('file://')) || pages[0];
console.log('URL ' + app.url());
const before = await app.evaluate(() => {
  const ta = document.querySelector('textarea[aria-label="Message Input"]');
  return { disabled: ta ? ta.disabled : null };
});
console.log('BEFORE_DISABLED ' + before.disabled);

const convRes = await fetch('http://127.0.0.1:4000/api/jarvis/conversations', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'cc5' }),
});
const conv = (await convRes.json()).id;
console.log('CONV ' + conv);
try {
  await app.evaluate(`(() => { sessionStorage.setItem('jarvis-active-conversation', '${conv}'); location.reload(); })()`);
  console.log('EVAL_OK');
} catch (e) {
  console.log('EVAL_FAIL ' + e.message);
}
await sleep(10000);
const after = await app.evaluate(() => {
  const ta = document.querySelector('textarea[aria-label="Message Input"]');
  return { disabled: ta ? ta.disabled : null, url: location.href };
});
console.log('AFTER ' + JSON.stringify(after));
await browser.disconnect();
