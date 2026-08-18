// Manual-style typed test through the real packaged GUI with console capture.
import puppeteer from 'puppeteer-core';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((p) => p.url().includes('file://')) || pages[0];
const logs = [];
app.on('console', (m) => { logs.push(m.type() + ': ' + m.text()); });

if (!app.url().includes('#/jarvis')) { await app.evaluate(() => { location.hash = '#/jarvis'; }); await sleep(6000); }

// type into the real textarea + click real Send
await app.evaluate(() => {
  const ta = document.querySelector('textarea[aria-label="Message Input"]');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  setter.call(ta, 'Jarvis, what model are you using?');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  document.querySelector('button[aria-label="Send Message"]')?.click();
});

// wait for a visible JARVIS reply + composer re-enable
let reply = '';
for (let i = 0; i < 50; i++) {
  await sleep(3000);
  const r = await app.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('[data-testid="jarvis-command-line"]')).map((l) => l.innerText.replace(/\s+/g, ' ').trim());
    const ta = document.querySelector('textarea[aria-label="Message Input"]');
    return { rows: rows.slice(-6), taDisabled: ta ? ta.disabled : null };
  });
  const jarvisRows = r.rows.filter((x) => x.startsWith('JARVIS'));
  if (jarvisRows.length > 0) reply = jarvisRows[jarvisRows.length - 1];
  if (reply && !r.taDisabled) break;
}
console.log('TYPED_REPLY ' + JSON.stringify(reply.slice(0, 220)));
console.log('DIAG_LOGS');
for (const l of logs.filter((x) => x.includes('VoiceDiag'))) console.log('D ' + l);
await browser.disconnect();
