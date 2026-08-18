// Capture all [VTurn] console logs during the user's 5-turn voice test.
import puppeteer from 'puppeteer-core';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((p) => p.url().includes('file://')) || pages[0];
const logs = [];
app.on('console', (m) => { logs.push(m.type() + ': ' + m.text()); });

console.log('CAPTURE_STARTED run the 5 voice turns now');
const deadline = Date.now() + 300000;
let sawTurn5Done = false;
while (Date.now() < deadline) {
  await sleep(3000);
  const recent = logs.filter((l) => l.includes('[VTurn] done')).length;
  if (recent >= 5) { sawTurn5Done = true; break; }
  if (logs.filter((l) => l.includes('[VTurn] handleSendMessage')).length >= 5) { sawTurn5Done = true; await sleep(20000); break; }
}
await sleep(10000);

console.log('TURN_LOG_DUMP');
for (const l of logs.filter((x) => x.includes('[VTurn]') || x.includes('[ConvTrace]'))) console.log('D ' + l);

const st = await app.evaluate(() => {
  const rows = Array.from(document.querySelectorAll('[data-testid="jarvis-command-line"]')).map((l) => l.innerText.replace(/\s+/g, ' ').trim()).slice(-12);
  const primary = document.querySelector('[data-testid="jarvis-primary-control"]');
  const ta = document.querySelector('textarea[aria-label="Message Input"]');
  return { rows, primary: primary ? primary.innerText.trim() : null, taDisabled: ta ? ta.disabled : null };
});
console.log('END_STATE ' + JSON.stringify(st, null, 1));
console.log('TURNS_SUBMITTED ' + logs.filter((l) => l.includes('[VTurn] handleSendMessage')).length);
console.log('TURNS_DONE ' + logs.filter((l) => l.includes('[VTurn] done')).length);
await browser.disconnect();
