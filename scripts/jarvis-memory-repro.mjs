// Reproduce the memory-store turn in the live packaged app and watch whether
// the composer re-enables. Reloads the page to clear any stuck state first.
import puppeteer from 'puppeteer-core';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((p) => p.url().includes('file://')) || pages[0];

// fresh conversation
const convRes = await fetch('http://127.0.0.1:4000/api/jarvis/conversations', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: 'memory-repro' }),
});
const conv = (await convRes.json()).id;
console.log('CONV ' + conv);

// clear stuck state + point at fresh conv
await app.evaluate((cid) => {
  sessionStorage.setItem('jarvis-active-conversation', cid);
  location.reload();
}, conv);
await sleep(9000);

const send = async (text) => {
  await app.evaluate((t) => {
    const ta = document.querySelector('textarea[aria-label="Message Input"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, t);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    const btn = document.querySelector('button[aria-label="Send Message"]');
    if (btn && !btn.disabled) btn.click();
  }, text);
};

const uiState = () =>
  app.evaluate(() => {
    const ta = document.querySelector('textarea[aria-label="Message Input"]');
    const send = document.querySelector('button[aria-label="Send Message"]');
    const rows = Array.from(document.querySelectorAll('[data-testid="jarvis-command-line"]')).map((l) => l.innerText.replace(/\s+/g, ' ').trim()).slice(-6);
    return {
      disabled: ta ? ta.disabled : null,
      spinner: send ? send.innerHTML.includes('loader') : null,
      rows,
    };
  });

// turn 1: memory store
console.log('SEND memory-store...');
await send('Remember that my test code word is ORBIT-47.');
for (let i = 0; i < 40; i++) {
  await sleep(3000);
  const s = await uiState();
  if (!s.disabled && !s.spinner) {
    console.log('TURN1_OK disabled=' + s.disabled + ' spinner=' + s.spinner);
    console.log('ROWS ' + JSON.stringify(s.rows));
    break;
  }
  if (i % 5 === 0) console.log('t=' + (i + 1) * 3 + 's disabled=' + s.disabled + ' spinner=' + s.spinner);
}

// turn 2: normal follow-up (must work after memory turn)
console.log('SEND normal...');
await send('What code word did I just ask you to remember?');
let finalState = null;
for (let i = 0; i < 40; i++) {
  await sleep(3000);
  const s = await uiState();
  finalState = s;
  if (!s.disabled && !s.spinner && s.rows.some((r) => r.startsWith('JARVIS') && r.length > 12)) {
    console.log('TURN2_OK');
    break;
  }
  if (i % 5 === 0) console.log('t2=' + (i + 1) * 3 + 's disabled=' + s.disabled + ' spinner=' + s.spinner);
}
console.log('FINAL ' + JSON.stringify(finalState));
await browser.disconnect();
