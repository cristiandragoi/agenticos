// Capture console + voice trace during ONE human voice turn (~60s window).
import puppeteer from 'puppeteer-core';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((p) => p.url().includes('file://')) || pages[0];
const logs = [];
app.on('console', (m) => { logs.push(m.type() + ': ' + m.text()); });

console.log('CAPTURE_STARTED speak now');
const deadline = Date.now() + 180000;
while (Date.now() < deadline) {
  await sleep(2000);
  if (logs.some((l) => l.includes('VoiceDiag') && l.includes('handleSendMessage'))) break;
  if (logs.some((l) => l.includes('VoiceDiag') && l.includes('manualEdit: true'))) break;
}

await sleep(8000); // let the reply stream

const diag = logs.filter((l) => l.includes('VoiceDiag') || l.includes('ConvTrace') || l.includes('JarvisChat:diag'));
console.log('DIAG_LOG_DUMP');
for (const l of diag) console.log('D ' + l);

const st = await app.evaluate(() => {
  const ta = document.querySelector('textarea[aria-label="Message Input"]');
  const rows = Array.from(document.querySelectorAll('[data-testid="jarvis-command-line"]')).map((l) => l.innerText.replace(/\s+/g, ' ').trim()).slice(-8);
  const trace = document.querySelector('[data-testid="voice-trace-stages"]');
  return { taDisabled: ta ? ta.disabled : null, rows, trace: trace ? trace.innerText.slice(0, 900) : null };
});
console.log('UI_STATE ' + JSON.stringify(st, null, 1));
await browser.disconnect();
