// Read current Jarvis UI state: composer disabled? processing? last rows?
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((p) => p.url().includes('file://')) || pages[0];
const state = await app.evaluate(() => {
  const ta = document.querySelector('textarea[aria-label="Message Input"]');
  const send = document.querySelector('button[aria-label="Send Message"]');
  const rows = Array.from(document.querySelectorAll('[data-testid="jarvis-command-line"]')).slice(-6).map((l) => l.innerText.replace(/\s+/g, ' ').trim());
  const primary = document.querySelector('[data-testid="jarvis-primary-control"]');
  const err = document.body.innerText.match(/empty response|failed|timed out|cancelled|Error/i);
  return {
    textareaDisabled: ta ? ta.disabled : 'NO_TA',
    sendDisabled: send ? send.disabled : 'NO_SEND',
    primaryLabel: primary ? primary.innerText.trim() : null,
    lastRows: rows,
    errHits: err ? [...new Set(err)].slice(0, 4) : [],
  };
});
console.log('UI_STATE ' + JSON.stringify(state));
await browser.disconnect();
