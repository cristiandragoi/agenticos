// Critical regression test (directive §7): while a CodeX goal is
// WAITING_FOR_APPROVAL, a typed conversational turn MUST still be answered.
// Step 1: type the codex-routing prompt in the real GUI (recreates the user's
// exact scenario). Step 2: verify goal reached waiting_for_approval.
// Step 3: type "Jarvis, are you still there?" -> must answer while goal waits.
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const page = pages.find(p => p.url().includes('/jarvis')) || pages[0];
const t0 = Date.now();
const ta = await page.$('textarea[aria-label="Message Input"], textarea');
if (!ta) { console.log('NO_TEXTAREA'); await browser.disconnect(); process.exit(1); }

const typeAndSend = async (text) => {
  await ta.click();
  await ta.type(text, { delay: 12 });
  await page.keyboard.press('Enter');
  console.log('SENT:', text.slice(0, 40), 'at +' + (Date.now() - t0) + 'ms');
};

// Step 1 — create the codex task (same prompt that routed CODEX 93% before)
await typeAndSend('Few it will be good if you can help me today to to, fix the codex.');
// wait for goal creation + plan generation (previous ~6s)
await new Promise(r => setTimeout(r, 9000));
console.log('AFTER_CODEX_SUBMIT +' + (Date.now() - t0) + 'ms');

// Step 2 — read goal state from the backend
const goalRes = await fetch('http://127.0.0.1:4000/api/chat/agents/goals?limit=5').catch(() => null);
let goalLines = 'n/a';
if (goalRes) goalLines = (await goalRes.text()).slice(0, 500);
console.log('GOALS API:', goalLines);

// Step 3 — the conversational turn while the goal waits
await typeAndSend('Jarvis, are you still there?');
const deadline = Date.now() + 25000;
let dom = null;
while (Date.now() < deadline) {
  await new Promise(r => setTimeout(r, 2000));
  dom = await page.evaluate(() => {
    const all = document.body.innerText;
    const idx = all.lastIndexOf('are you still there');
    return idx >= 0 ? all.slice(idx, idx + 500).replace(/\n+/g, ' | ') : null;
  });
  if (dom && /(yes|here|still|ready|model|help)/i.test(dom) && dom.length > 30) break;
}
console.log('DOM after conversational turn:', JSON.stringify(dom));
console.log('DONE_MS:', Date.now() - t0);
await browser.disconnect();
