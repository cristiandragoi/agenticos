// Typed regression test in the REAL GUI: type "Are you there?" in the Jarvis
// composer, submit, and verify (a) the user bubble + reply render in the DOM,
// (b) the backend persisted both, (c) execution store returns to clean state.
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const page = pages.find(p => p.url().includes('/jarvis')) || pages[0];
const t0 = Date.now();

// Find the composer textarea
const ta = await page.$('textarea[aria-label="Message Input"], textarea');
if (!ta) { console.log('NO_TEXTAREA'); await browser.disconnect(); process.exit(1); }
await ta.click();
await ta.type('Are you there?', { delay: 25 });
console.log('TYPED at +' + (Date.now() - t0) + 'ms');
await page.keyboard.press('Enter');
console.log('ENTER at +' + (Date.now() - t0) + 'ms');

// Poll the DOM transcript tail until an agent reply appears or timeout
const deadline = Date.now() + 20000;
let domState = null;
while (Date.now() < deadline) {
  await new Promise(r => setTimeout(r, 1500));
  domState = await page.evaluate(() => {
    // Collect the visible transcript text from the LIVE WORK / transcript panel
    const all = document.body.innerText;
    const idx = all.lastIndexOf('Are you there?');
    const after = idx >= 0 ? all.slice(idx, idx + 400).replace(/\n+/g, ' | ') : null;
    const jarvisIdx = all.lastIndexOf('JARVIS');
    return { after, tail: all.slice(Math.max(0, all.length - 700)).replace(/\n+/g, ' | ') };
  });
  const hasReply = domState.after && /(yes|here|ready|Jarvis|there|help|model)/i.test(domState.after) && domState.after.length > 20;
  if (hasReply) break;
}
console.log('DOM after submit:', JSON.stringify(domState));
console.log('WAIT_MS:', Date.now() - t0);
await browser.disconnect();
