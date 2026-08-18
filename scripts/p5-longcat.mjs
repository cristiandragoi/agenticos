// P5: LongCat assignment/persistence + 402 status + STOP interruption.
import puppeteer from 'puppeteer-core';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((p) => p.url().includes('file://')) || pages[0];

// 1) assignment persistence via the backend API
const assignment = await app.evaluate(async () => {
  try {
    const res = await fetch('http://localhost:4000/api/jarvis/assignment');
    const j = await res.json();
    return j;
  } catch (e) { return { err: String(e) }; }
});
console.log('ASSIGNMENT ' + JSON.stringify(assignment));

// 2) load the workspace, send a real turn, capture the error
await app.goto('file:///B:/AgenticOS/dist/index.html', { waitUntil: 'load' });
await sleep(4000);
await app.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => /Retry connection/i.test(x.textContent || ''));
  if (b) b.click();
});
await sleep(6000);
await app.evaluate(() => { location.hash = '#/jarvis'; });
await sleep(2500);
await app.evaluate(() => {
  const t = [...document.querySelectorAll('button')].find((x) => /SHOW DOCK/i.test(x.textContent || ''));
  if (t) t.click();
});
await sleep(2000);

const lastTranscript = async () => {
  return app.evaluate(() => {
    const sc = document.querySelector('[data-testid="jarvis-chat-scroll"]');
    return sc ? sc.innerText.split('\n').slice(-8) : [];
  });
};

await app.evaluate(() => {
  const ta = document.querySelector('textarea');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
  if (setter) setter.call(ta, 'P5 conversation turn one');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
});
await sleep(500);
await app.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.getAttribute('aria-label') === 'Send Message'); if (b) b.click(); });
await sleep(7000);
console.log('TURN1 ' + JSON.stringify(await lastTranscript()));

// 3) interruption: send another turn, hit STOP quickly, check cancel + no stuck state
await app.evaluate(() => {
  const ta = document.querySelector('textarea');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
  if (setter) setter.call(ta, 'P5 turn to interrupt');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
});
await sleep(400);
await app.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.getAttribute('aria-label') === 'Send Message'); if (b) b.click(); });
await sleep(1500);
// press STOP (execution bar / chat cancel)
const stopped = await app.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => /^STOP$/i.test((x.textContent || '').trim()) || /STOP/i.test((x.getAttribute('aria-label') || '')));
  if (b) { b.click(); return b.textContent.trim(); }
  return null;
});
console.log('STOPBTN ' + JSON.stringify(stopped));
await sleep(4000);
console.log('AFTERSTOP ' + JSON.stringify(await lastTranscript()));
const stateAfterStop = await app.evaluate(() => {
  const a = document.querySelector('[data-insight="active"]');
  return a ? a.innerText.replace('ACTIVE WORK\n', '').slice(0, 60) : null;
});
console.log('ACTIVEAFTERSTOP ' + JSON.stringify(stateAfterStop));

// 4) persistence: reload page, check assignment + history retained
await app.reload({ waitUntil: 'load' });
await sleep(5000);
await app.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => /Retry connection/i.test(x.textContent || ''));
  if (b) b.click();
});
await sleep(6000);
await app.evaluate(() => { location.hash = '#/jarvis'; });
await sleep(3000);
await app.evaluate(() => {
  const t = [...document.querySelectorAll('button')].find((x) => /SHOW DOCK/i.test(x.textContent || ''));
  if (t) t.click();
});
await sleep(2000);
const afterReload = await app.evaluate(() => {
  const sc = document.querySelector('[data-testid="jarvis-chat-scroll"]');
  const lines = sc ? sc.innerText.split('\n') : [];
  const last = lines.slice(-6);
  const hasP5 = lines.some((l) => l.includes('P5 conversation turn one'));
  return { hasP5History: hasP5, last };
});
console.log('AFTERRELOAD ' + JSON.stringify(afterReload));
await browser.disconnect();
