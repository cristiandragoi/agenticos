// Deeper DOM probe: find message rows + voice trace stage elements on #/jarvis.
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const page = pages.find((p) => p.url().startsWith('file:')) || pages[0];
const info = await page.evaluate(() => {
  const out = {};
  // All elements containing a role-ish marker: search for common message classes
  const roleEls = [];
  document.querySelectorAll('[class*="message" i], [class*="Message"], [data-role], [data-testid*="message" i]').forEach((el) => {
    const cls = typeof el.className === 'string' ? el.className : '';
    const text = (el.innerText || '').trim().slice(0, 60);
    roleEls.push({ tag: el.tagName, cls: cls.slice(0, 60), text });
  });
  out.roleEls = roleEls.slice(0, 25);
  // Look for the voice trace stage names in the DOM
  out.hasVadStage = document.body.innerText.includes('vad_triggered') || document.body.innerText.includes('VAD');
  out.hasTracePanel = document.body.innerText.includes('audio_captured') || document.body.innerText.includes('Auto-submitted');
  // Recent conversation tail text
  const body = document.body.innerText;
  out.tail = body.slice(-1200).replace(/\n+/g, ' | ').slice(0, 1200);
  return out;
});
console.log('ROLE_ELS:');
for (const e of info.roleEls) console.log(' ', e.tag, e.cls, '|', JSON.stringify(e.text));
console.log('HAS_VAD_STAGE:', info.hasVadStage);
console.log('HAS_TRACE_PANEL:', info.hasTracePanel);
console.log('BODY_TAIL:', info.tail);
await browser.disconnect();
