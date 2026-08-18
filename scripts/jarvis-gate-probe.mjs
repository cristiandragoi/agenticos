// Probe current composer/offline-gate/lifecycle state in the running app.
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((p) => p.url().includes('file://')) || pages[0];
const s = await app.evaluate(() => {
  const ta = document.querySelector('textarea[aria-label="Message Input"]');
  const offline = document.querySelector('[data-testid="jarvis-offline-gate"]');
  const micBtn = document.querySelector('[data-testid="jarvis-mic-toggle"], button[aria-label*="ic"]');
  const body = document.body.innerText;
  return {
    composerValue: ta ? ta.value : null,
    taDisabled: ta ? ta.disabled : null,
    placeholder: ta ? ta.placeholder : null,
    offlineGate: offline ? offline.innerText.replace(/\s+/g, ' ').trim().slice(0, 200) : null,
    hasOfflineText: body.includes('Backend offline') || body.includes('offline — Jarvis'),
    hasConnectedText: body.includes('Backend: Connected'),
    url: location.href,
  };
});
console.log('GATE_PROBE ' + JSON.stringify(s));
await browser.disconnect();
