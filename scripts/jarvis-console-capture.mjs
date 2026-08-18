// Capture the renderer console DURING a memory-store turn to find exactly
// where the stream loop stops (JarvisChat DEV_TIMING logs stream-done etc.).
import puppeteer from 'puppeteer-core';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((p) => p.url().includes('file://')) || pages[0];

const consoleLines = [];
// subscribe via CDP (captures console.error markers added to JarvisChat)
app.on('console', (msg) => { consoleLines.push(msg.type() + ': ' + msg.text()); });

// fresh conversation + navigate to Jarvis + reload to clear stuck state
const convRes = await fetch('http://127.0.0.1:4000/api/jarvis/conversations', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'console-repro' }),
});
const conv = (await convRes.json()).id;
await app.evaluate(`(() => { sessionStorage.setItem('jarvis-active-conversation', '${conv}'); location.hash = '#/jarvis'; location.reload(); })()`);
await sleep(9000);

// send the memory-store prompt
await app.evaluate(() => {
  const ta = document.querySelector('textarea[aria-label="Message Input"]');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  setter.call(ta, 'Remember that my test code word is ORBIT-47.');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  document.querySelector('button[aria-label="Send Message"]')?.click();
});

await sleep(20000);

console.log('CDP_CONSOLE');
for (const l of consoleLines.slice(-60)) console.log('D ' + l);
const st = await app.evaluate(() => {
  const ta = document.querySelector('textarea[aria-label="Message Input"]');
  return { disabled: ta ? ta.disabled : null };
});
console.log('COMPOSER_DISABLED ' + st.disabled);
await browser.disconnect();
