// Real-user scroll simulation: wheel over the transcript, then verify
// jump-to-latest appears and appends don't yank back to bottom.
import puppeteer from 'puppeteer-core';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((p) => p.url().includes('file://')) || pages[0];
await app.evaluate(() => { location.hash = '#/jarvis'; });
await sleep(5000);

const wheel = async (deltaY) => {
  const rect = await app.evaluate(() => {
    const sc = document.querySelector('[data-testid="jarvis-chat-scroll"]');
    const r = sc.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await app.mouse.move(rect.x, rect.y);
  // multiple wheel steps (CDP wheel events scroll the element under the cursor)
  for (let i = 0; i < 12; i++) await app.mouse.wheel({ deltaY });
  await sleep(800);
};

const state = () => app.evaluate(() => {
  const sc = document.querySelector('[data-testid="jarvis-chat-scroll"]');
  return {
    scrollTop: sc ? Math.round(sc.scrollTop) : null,
    atBottom: sc ? sc.scrollHeight - sc.scrollTop - sc.clientHeight < 140 : null,
    jump: !!document.querySelector('[data-testid="jarvis-jump-to-latest"]'),
  };
});

console.log('start ' + JSON.stringify(await state()));
await wheel(120); // scroll down a bit (should stay at bottom)
console.log('after down ' + JSON.stringify(await state()));
await wheel(-300); // scroll UP (user reading history)
console.log('after up ' + JSON.stringify(await state()));

// while scrolled up, append a message via a send
await app.evaluate(() => {
  const ta = document.querySelector('textarea');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
  if (setter) setter.call(ta, 'Theta eight');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
});
await sleep(400);
await app.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.getAttribute('aria-label') === 'Send Message'); if (b) b.click(); });
await sleep(4000);
console.log('after append-while-up ' + JSON.stringify(await state()));

await browser.disconnect();
