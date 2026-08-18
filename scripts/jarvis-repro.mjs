// Reproduce the Jarvis empty-response in the REAL packaged app over CDP.
// Types into the composer, clicks Send, polls the transcript + activity
// stream, and reports what actually happened (reply text / error text).
import puppeteer from 'puppeteer-core';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((p) => p.url().includes('file://')) || pages[0];

if (!app.url().includes('#/jarvis')) {
  await app.evaluate(() => { location.hash = '#/jarvis'; });
  await sleep(6000);
}

const snapshot = () =>
  app.evaluate(() => {
    const lines = Array.from(document.querySelectorAll('[data-testid="jarvis-command-line"]'));
    const lastRows = lines.slice(-6).map((l) => l.innerText.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const stream = document.querySelector('[data-testid="jarvis-activity-stream"]');
    const dot = document.querySelector('[data-testid="backend-status-dot"]');
    const chip = dot ? dot.closest('button') : null;
    const err = document.body.innerText.match(/empty response|Jarvis response failed|request timed out|cancelled|Error/gi);
    return {
      rows: lastRows,
      activity: stream ? stream.innerText.slice(0, 300) : null,
      backend: chip ? chip.innerText.replace(/\s+/g, ' ').trim() : null,
      errorHits: err ? [...new Set(err)].slice(0, 5) : [],
    };
  });

async function sendPrompt(text) {
  await app.evaluate((t) => {
    const ta = document.querySelector('textarea[aria-label="Message Input"]');
    if (!ta) return 'NO_TEXTAREA';
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, t);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    const btn = document.querySelector('button[aria-label="Send Message"]');
    if (btn && !btn.disabled) btn.click();
    return 'SENT';
  }, text);
}

const prompt = process.argv[2] || 'Hello Jarvis. Reply with exactly: Jarvis is working.';
console.log('REPRO_PROMPT ' + prompt);
const sendResult = await sendPrompt(prompt);
console.log('REPRO_SEND ' + sendResult);
await sleep(4000);
console.log('REPRO_T0 ' + JSON.stringify(await snapshot()));

let final = null;
for (let i = 0; i < 40; i++) {
  await sleep(3000);
  const snap = await snapshot();
  const rows = snap.rows.join(' || ');
  if (i % 5 === 0) console.log(`REPRO_T${(i + 1) * 3}s ${JSON.stringify(snap).slice(0, 500)}`);
  // done when the last row is a non-empty assistant reply or an error row appears
  const lastRow = snap.rows[snap.rows.length - 1] || '';
  if (snap.errorHits.some((e) => /empty response|response failed|timed out|cancelled/i.test(e))) {
    final = { outcome: 'ERROR', ...snap };
    break;
  }
  if (lastRow.length > 8 && !/USER:.*$/.test(lastRow)) {
    final = { outcome: 'REPLY', ...snap };
    break;
  }
}
if (!final) final = { outcome: 'TIMEOUT', ...(await snapshot()) };
console.log('REPRO_FINAL ' + JSON.stringify(final));
await browser.disconnect();
