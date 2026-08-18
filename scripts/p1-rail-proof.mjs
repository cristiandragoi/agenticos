// Verify LeftRail picks up the active project when the app STORE selects it
// (the real user path: click "Set Active" in ProjectsPage → store state).
import puppeteer from 'puppeteer-core';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((p) => p.url().includes('file://')) || pages[0];
const targets = await browser.targets();
const tgt = targets.find((t) => t.type() === 'page' && t.url().includes('file://'));
const cdp = await tgt.createCDPSession();
await cdp.send('Page.enable');

const BASE = 'http://127.0.0.1:4600';
const j = async (path, opts) => {
  const res = await fetch(BASE + path, opts);
  let body = null; try { body = await res.json(); } catch {}
  return { status: res.status, body };
};
const stamp = Date.now().toString(36).slice(-5);
const created = await j('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: `Rail Proj ${stamp}` }) });
const projId = created.body?.id;

// Load Jarvis FIRST so the store mounts, then create+select via API and reload the page (remount = refetch).
await app.evaluate(() => { location.hash = '#/jarvis'; });
await sleep(6000);
await j('/api/projects/active', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: projId }) });
// Remount the store by navigating away and back (the app's real refresh path).
await app.evaluate(() => { location.hash = '#/projects'; });
await sleep(5000);
await app.evaluate(() => { location.hash = '#/jarvis'; });
await sleep(6000);
const rail = await app.evaluate(() => {
  const nav = document.querySelector('[data-testid="nav-projects"]');
  return {
    navLabel: nav ? nav.textContent.replace(/\s+/g, ' ').trim().slice(0, 40) : null,
    activeLabel: document.body.innerText.includes('ACTIVE: Rail Proj'),
  };
});
console.log('LEFTRAIL_AFTER_REMOUNT ' + JSON.stringify(rail));
await j('/api/projects/active', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: null }) });
await j('/api/projects/' + projId, { method: 'DELETE' });
await browser.disconnect();
