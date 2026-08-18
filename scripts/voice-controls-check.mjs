// Voice control surface check: VOICE ON/OFF toggle changes state; controls exist.
import puppeteer from 'puppeteer-core';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((p) => p.url().includes('file://')) || pages[0];
const targets = await browser.targets();
const tgt = targets.find((t) => t.type() === 'page' && t.url().includes('file://'));
const cdp = await tgt.createCDPSession();
await cdp.send('Page.enable');
await app.evaluate(() => { location.hash = '#/jarvis'; });
await sleep(8000);

const controls = await app.evaluate(() => {
  const find = (label) => [...document.querySelectorAll('button')].find((b) => (b.textContent || '').includes(label));
  return {
    voiceToggle: find('VOICE') ? find('VOICE').textContent.trim() : null,
    mic: find('MIC') ? find('MIC').textContent.trim() : null,
    modeManual: !!document.querySelector('[data-testid="jarvis-mode-manual"]'),
    modeConversation: !!document.querySelector('[data-testid="jarvis-mode-conversation"]'),
    primary: document.querySelector('[data-testid="jarvis-primary-control"]')?.textContent?.trim() || null,
  };
});
console.log('CONTROLS ' + JSON.stringify(controls));

// Click VOICE OFF/ON and observe label change (state agreement).
const voiceBefore = await app.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => /VOICE (ON|OFF)/.test(x.textContent || ''));
  return b ? b.textContent.trim() : null;
});
await app.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => /VOICE (ON|OFF)/.test(x.textContent || ''));
  if (b) b.click();
});
await sleep(500);
const voiceAfter = await app.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => /VOICE (ON|OFF)/.test(x.textContent || ''));
  return b ? b.textContent.trim() : null;
});
console.log('VOICE_TOGGLE ' + JSON.stringify({ before: voiceBefore, after: voiceAfter, changed: voiceBefore !== voiceAfter }));
await browser.disconnect();
