// Probe the stuck composer: offline gate? spinner (isProcessing)? send label?
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((p) => p.url().includes('file://')) || pages[0];
const s = await app.evaluate(() => {
  const offline = document.querySelector('[data-testid="jarvis-offline-gate"]');
  const send = document.querySelector('button[aria-label="Send Message"]');
  const sendBtn = document.querySelector('[data-testid="jarvis-primary-control"]');
  return {
    offlineGate: offline ? offline.innerText.replace(/\s+/g, ' ').trim().slice(0, 160) : null,
    sendHtml: send ? send.innerHTML.slice(0, 300) : null,
    primaryHtml: sendBtn ? sendBtn.innerHTML.slice(0, 200) : null,
    bodyText: document.body.innerText.slice(0, 300),
  };
});
console.log('STUCK_PROBE ' + JSON.stringify(s));
await browser.disconnect();
