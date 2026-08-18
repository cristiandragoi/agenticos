// Voice code-path proof: send a Jarvis turn with VOICE ON, capture the
// /voice/tts request + the Voice Trace panel stages (TTS + playback).
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
await sleep(500);
await cdp.send('Page.reload');
await sleep(12000);

const ttsPosts = [];
const diagLogs = [];
const errors = [];
app.on('request', (r) => { if (r.url().includes('/voice/tts')) { try { ttsPosts.push(JSON.parse(r.postData() || '{}')); } catch {} } });
app.on('console', (m) => {
  const t = m.text();
  if (t.includes('[VoiceDiag]') || t.includes('playback_started') || t.includes('MEDIA_ELEMENT')) diagLogs.push(t.slice(0, 200));
  if (m.type() === 'error') errors.push(m.text().slice(0, 150));
});

// Ensure VOICE ON.
await app.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => /VOICE OFF/.test(x.textContent || ''));
  if (b) b.click();
});
await sleep(500);

// New conversation + a short turn.
await app.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => /ACTIONS/i.test(x.textContent || ''));
  if (b) b.click();
});
await sleep(500);
await app.evaluate(() => {
  const items = [...document.querySelectorAll('button')].filter((b) => /New conversation/i.test(b.textContent || ''));
  if (items[0]) items[0].click();
});
await sleep(2000);
const ta = await app.$('textarea');
if (ta) {
  await app.evaluate(() => {
    const el = document.querySelector('textarea');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(el, '');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(200);
  await ta.type('Say hello in one short sentence.', { delay: 10 });
  await sleep(300);
  await app.keyboard.press('Enter');
}
await sleep(25000);

const trace = await app.evaluate(() => {
  const el = document.querySelector('[data-testid="jarvis-workspace-diagnostics"]');
  return el ? el.textContent.replace(/\s+/g, ' ').slice(0, 400) : null;
});
console.log('TTS_POSTS ' + JSON.stringify(ttsPosts.map((p) => ({ textLen: (p.text || '').length, voice: p.voice, agentId: p.agentId }))));
console.log('DIAG_LOGS ' + JSON.stringify(diagLogs.slice(-8)));
console.log('TRACE ' + JSON.stringify(trace));
console.log('ERRORS ' + JSON.stringify(errors.slice(-4)));
await browser.disconnect();
