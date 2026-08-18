// Read the last voice turn trace from the running app's VoiceTracePanel.
import puppeteer from 'puppeteer-core';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((p) => p.url().includes('file://')) || pages[0];

if (!app.url().includes('#/jarvis')) {
  await app.evaluate(() => { location.hash = '#/jarvis'; });
  await sleep(6000);
}
// Expand the trace panel if collapsed
await app.evaluate(() => {
  const t = document.querySelector('[data-testid="voice-trace-toggle"]');
  if (t) t.click();
});
await sleep(800);
const trace = await app.evaluate(() => {
  const stages = document.querySelector('[data-testid="voice-trace-stages"]');
  const checklist = document.querySelector('[data-testid="voice-trace-checklist"]');
  const panel = document.querySelector('[data-testid="voice-trace-panel"]');
  return {
    panelVisible: !!panel,
    stages: stages ? stages.innerText.slice(0, 1200) : null,
    checklist: checklist ? checklist.innerText.slice(0, 800) : null,
  };
});
console.log('VOICE_TRACE ' + JSON.stringify(trace, null, 1));
await browser.disconnect();
