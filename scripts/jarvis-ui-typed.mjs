// Phase 26: drive the REAL UI composer via CDP — type a question, click Send,
// watch the DOM for the assistant message, verify the composer resets.
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const page = pages.find((p) => p.url().startsWith('file:')) || pages[0];
console.log('URL:', page.url().slice(0, 80));

// Find the composer input
const probe = await page.evaluate(() => {
  const inputs = Array.from(document.querySelectorAll('textarea, input[type="text"], [contenteditable="true"]'))
    .map((el) => ({ tag: el.tagName, cls: (el.className || '').toString().slice(0, 60), ph: el.getAttribute && el.getAttribute('placeholder') }))
    .slice(0, 10);
  return inputs;
});
console.log('INPUTS:', JSON.stringify(probe));

// Take the last textarea/input as the composer
const sel = await page.evaluate(() => {
  const el = document.querySelector('textarea') || document.querySelector('input[type="text"]') || document.querySelector('[contenteditable="true"]');
  if (!el) return null;
  // Give the element a stable marker
  el.setAttribute('data-composer-probe', '1');
  return el.tagName;
});
console.log('COMPOSER_TAG:', sel);
if (!sel) process.exit(1);

// Baseline message count
const before = await page.evaluate(() => document.body.innerText.includes('Jarvis:'));
const t0 = Date.now();

// Type the question (React inputs need native setter + input event)
await page.evaluate(() => {
  const el = document.querySelector('[data-composer-probe]');
  const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, 'What model are you using?');
  el.dispatchEvent(new Event('input', { bubbles: true }));
});

// Click Send — try the Send button; fall back to Enter on the input.
const clicked = await page.evaluate(() => {
  const input = document.querySelector('[data-composer-probe]');
  // Find a button inside the composer container (icon or text).
  let container = input;
  for (let i = 0; i < 4 && container.parentElement; i++) container = container.parentElement;
  const btns = Array.from(container.querySelectorAll('button'));
  const send = btns.find((b) => /send|➤|arrow|paper/i.test((b.innerText || '') + (b.getAttribute('aria-label') || '') + (b.getAttribute('title') || '')));
  if (send) { send.click(); return 'button'; }
  return 'none';
});
if (clicked === 'none') {
  await page.evaluate(() => {
    const el = document.querySelector('[data-composer-probe]');
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
  });
}
console.log('SEND_MECHANISM:', clicked, 't+', Date.now() - t0, 'ms');

// Watch for the assistant answer in the DOM (up to 30s)
let answer = '';
let firstVisibleAt = 0;
for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 500));
  const tail = await page.evaluate(() => document.body.innerText.slice(-3000));
  const m = tail.match(/Jarvis:\s*([^\n]{5,200})/g);
  if (m && m.length) {
    const last = m[m.length - 1];
    if (!last.includes('What model are you using')) {
      answer = last;
      firstVisibleAt = Date.now() - t0;
      break;
    }
  }
}
console.log('FIRST_VISIBLE_AT_MS:', firstVisibleAt || 'N/A');
console.log('ANSWER_VISIBLE:', JSON.stringify(answer.slice(0, 250)));

// Composer reset check
await new Promise((r) => setTimeout(r, 1500));
const composerVal = await page.evaluate(() => {
  const el = document.querySelector('[data-composer-probe]');
  return el ? el.value || el.innerText || '' : '(missing)';
});
console.log('COMPOSER_VALUE_AFTER:', JSON.stringify(composerVal.slice(0, 60)));
console.log('COMPOSER_RESET:', composerVal.trim() === '');
await browser.disconnect();
