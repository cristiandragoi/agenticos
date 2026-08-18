// Send a turn reliably; watch transcript + backend POST.
import puppeteer from 'puppeteer-core';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((p) => p.url().includes('file://')) || pages[0];
await app.evaluate(() => { location.hash = '#/jarvis'; });
await sleep(5000);

const typed = await app.evaluate(() => {
  const ta = document.querySelector('textarea');
  if (!ta) return { ok: false, why: 'no textarea' };
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
  if (setter) setter.call(ta, 'Summarize the AgenticOS architecture in one sentence.');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  return { ok: true, value: ta.value };
});
await sleep(600);
const before = await app.evaluate(() => ({
  taValue: document.querySelector('textarea')?.value || '',
  sendDisabled: (() => { const b = [...document.querySelectorAll('button')].find((x) => x.getAttribute('aria-label') === 'Send Message'); return b ? b.disabled : 'missing'; })(),
}));
console.log('TYPED ' + JSON.stringify(typed) + ' BEFORE ' + JSON.stringify(before));

if (typed.ok) {
  await app.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.getAttribute('aria-label') === 'Send Message');
    if (b) b.click();
  });
}
for (let i = 0; i < 20; i++) {
  await sleep(3000);
  const st = await app.evaluate(() => {
    const ta = document.querySelector('textarea');
    const wrap = document.querySelector('[data-testid="jarvis-orb"]');
    return { taValue: ta?.value || '', orbState: wrap?.getAttribute('data-orb-state') || null };
  });
  console.log('t+' + (i + 1) * 3 + 's ' + JSON.stringify(st));
  if (st.taValue === '' && st.orbState === 'idle') break; // sent + settled
}
const transcript = await app.evaluate(() => {
  const el = document.querySelector('[data-testid="jarvis-transcript"], .transcript, [class*="transcript"]');
  return el ? (el.textContent || '').slice(-400) : null;
});
console.log('TRANSCRIPT ' + JSON.stringify(transcript));
await browser.disconnect();
