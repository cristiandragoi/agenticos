// Read live voice diagnostics from the running app after the user's 3-turn test.
import puppeteer from 'puppeteer-core';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((p) => p.url().includes('file://')) || pages[0];

if (!app.url().includes('#/jarvis')) { await app.evaluate(() => { location.hash = '#/jarvis'; }); await sleep(6000); }

const out = await app.evaluate(() => {
  // expand voice trace panel
  const t = document.querySelector('[data-testid="voice-trace-toggle"]');
  if (t) t.click();
  return {
    url: location.href,
    traceStages: (document.querySelector('[data-testid="voice-trace-stages"]') || {}).innerText?.slice(0, 1600) || null,
    rows: Array.from(document.querySelectorAll('[data-testid="jarvis-command-line"]')).map((l) => l.innerText.replace(/\s+/g, ' ').trim()).slice(-10),
    convTraceVad: null,
    convTracePanel: null,
    primary: (document.querySelector('[data-testid="jarvis-primary-control"]') || {}).innerText || null,
    taDisabled: (document.querySelector('textarea[aria-label="Message Input"]') || {}).disabled ?? null,
  };
});
await sleep(400);
const out2 = await app.evaluate(() => {
  // the conversation panel may be in a drawer — check for its trace elements
  const all = Array.from(document.querySelectorAll('[data-testid]'))
    .map((el) => el.getAttribute('data-testid')).filter(Boolean);
  return { testids: [...new Set(all)].filter((x) => /conv|trace|voice/i.test(x)).slice(0, 20) };
});
console.log('UI_TRACE ' + JSON.stringify(out, null, 1));
console.log('TESTIDS ' + JSON.stringify(out2));
await browser.disconnect();
