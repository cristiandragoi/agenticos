// Dock acceptance: reload, verify expanded, type a draft, collapse, verify:
// - toggle exists and works
// - workspace shrinks / composer hides
// - draft text survives in the mounted composer
// - expand restores
import puppeteer from 'puppeteer-core';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((p) => p.url().includes('file://')) || pages[0];
const targets = await browser.targets();
const tgt = targets.find((t) => t.type() === 'page' && t.url().includes('file://'));
const cdp = await tgt.createCDPSession();
await cdp.send('Page.enable');
await app.evaluate(() => { location.hash = '#/jarvis'; });
await sleep(500);
await cdp.send('Page.reload');
await sleep(12000);

// Clear persisted dock state so we start expanded.
await app.evaluate(() => { try { sessionStorage.setItem('jarvis.workspaceDockOpen', '1'); } catch {} });
await app.evaluate(() => { location.hash = '#/jarvis'; });
await sleep(6000);

const measure = () => app.evaluate(() => {
  const ws = document.querySelector('[data-testid="jarvis-workspace"]');
  const composer = document.querySelector('[data-testid="jarvis-sticky-composer"]');
  const stage = document.querySelector('[data-testid="jarvis-stage"]');
  const toggle = document.querySelector('[data-testid="jarvis-workspace-dock-toggle"]');
  const ta = document.querySelector('textarea');
  return {
    toggleText: toggle ? toggle.textContent.trim() : null,
    wsH: ws ? Math.round(ws.getBoundingClientRect().height) : null,
    stageH: stage ? Math.round(stage.getBoundingClientRect().height) : null,
    composerDisplay: composer ? getComputedStyle(composer).display : null,
    composerH: composer ? Math.round(composer.getBoundingClientRect().height) : null,
    hasTextarea: !!ta,
  };
});

console.log('EXPANDED ' + JSON.stringify(await measure()));

// Type a draft into the composer.
const ta = await app.$('textarea');
if (ta) {
  await app.evaluate(() => {
    const el = document.querySelector('textarea');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(el, 'DRAFT-SURVIVES');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(300);
}
const draftBefore = await app.evaluate(() => document.querySelector('textarea')?.value || '');
console.log('DRAFT_BEFORE ' + JSON.stringify(draftBefore));

// Collapse.
await app.evaluate(() => document.querySelector('[data-testid="jarvis-workspace-dock-toggle"]')?.click());
await sleep(800);
console.log('COLLAPSED ' + JSON.stringify(await measure()));

// Draft survived?
const draftAfter = await app.evaluate(() => {
  // The composer is display:none but the textarea is still mounted.
  const ta = document.querySelector('textarea');
  return ta ? ta.value : 'NO-TEXTAREA';
});
console.log('DRAFT_AFTER ' + JSON.stringify(draftAfter));

// Expand again.
await app.evaluate(() => document.querySelector('[data-testid="jarvis-workspace-dock-toggle"]')?.click());
await sleep(800);
console.log('REEXPANDED ' + JSON.stringify(await measure()));
const draftAfterExpand = await app.evaluate(() => document.querySelector('textarea')?.value || '');
console.log('DRAFT_AFTER_EXPAND ' + JSON.stringify(draftAfterExpand));
await browser.disconnect();
