// P7: click START CONVERSATION → observe mode transition + mic state.
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

const btn = async () => {
  return app.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /START CONVERSATION|END CONVERSATION|LISTENING|STOP SPEAKING/i.test((x.textContent || '').trim()));
    return b ? b.textContent.trim() : null;
  });
};
const chips = async (tag) => {
  const c = await app.evaluate(() => {
    const text = document.body.innerText;
    const mic = text.split('\n').findIndex((l) => l === 'MIC');
    const voice = text.split('\n').findIndex((l) => l === 'VOICE');
    return { micLine: mic >= 0 ? text.split('\n').slice(mic, mic + 2).join(' ') : null, voiceLine: voice >= 0 ? text.split('\n').slice(voice, voice + 2).join(' ') : null };
  });
  console.log(tag + ' ' + JSON.stringify(c));
};

console.log('BEFORE ' + JSON.stringify(await btn()));
await chips('before');
// click START CONVERSATION
const clicked = await app.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => /START CONVERSATION/i.test((x.textContent || '').trim()));
  if (b) { b.click(); return true; }
  return false;
});
console.log('CLICKED ' + clicked);
await sleep(2000);
console.log('AFTER1 ' + JSON.stringify(await btn()));
await chips('after1');
await sleep(3000);
console.log('AFTER2 ' + JSON.stringify(await btn()));
await chips('after2');
await browser.disconnect();
