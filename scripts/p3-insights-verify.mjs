// Phase 3 Slice 2 verification — insights panel renders with REAL data:
// idle state ('—' rows), then a live Jarvis turn populates UNDERSTOOD /
// ACTIVE WORK / RESULT from actual runtime signals. Visionless.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = 'http://localhost:4000';
const results = {};

const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((p) => p.url().includes('file://')) || pages[0];
await app.evaluate(() => { location.hash = '#/jarvis'; });
await sleep(7000);

// 1. Panel present + row values at idle.
const idle = await app.evaluate(() => {
  const panel = document.querySelector('[data-testid="jarvis-insights"]');
  if (!panel) return { present: false };
  const rows = {};
  for (const el of panel.querySelectorAll('[data-insight]')) {
    rows[el.getAttribute('data-insight')] = el.textContent.trim().slice(0, 60);
  }
  return { present: true, rows };
});
results.idle = idle;

// 2. Send a REAL typed turn through the page-level composer.
const sent = await app.evaluate(() => {
  const ta = document.querySelector('[data-testid="jarvis-composer-textarea"], textarea');
  if (!ta) return { ok: false, why: 'no composer textarea' };
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
  if (setter) setter.call(ta, 'Reply with exactly: INSIGHTS_OK');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  return { ok: true };
});
results.send = sent;
await sleep(400);
const clicked = await app.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => /send/i.test(b.textContent || '') || b.getAttribute('aria-label') === 'Send');
  if (btn) { btn.click(); return { ok: true }; }
  return { ok: false };
});
results.sendClick = clicked;

// 3. Sample the panel DURING the turn (UNDERSTOOD + ACTIVE WORK populated).
await sleep(3500);
const during = await app.evaluate(() => {
  const panel = document.querySelector('[data-testid="jarvis-insights"]');
  if (!panel) return null;
  const rows = {};
  for (const el of panel.querySelectorAll('[data-insight]')) rows[el.getAttribute('data-insight')] = el.textContent.trim().slice(0, 60);
  return rows;
});
results.during = during;

// 4. After completion: RESULT should show the real reply.
await sleep(16000);
const after = await app.evaluate(() => {
  const panel = document.querySelector('[data-testid="jarvis-insights"]');
  if (!panel) return null;
  const rows = {};
  for (const el of panel.querySelectorAll('[data-insight]')) rows[el.getAttribute('data-insight')] = el.textContent.trim().slice(0, 80);
  return rows;
});
results.after = after;

// 5. Screenshots for the human gate.
fs.mkdirSync('scripts/p3-shots', { recursive: true });
await app.screenshot({ path: 'scripts/p3-shots/jarvis-insights-full.png', fullPage: false });
const panelEl = await app.$('[data-testid="jarvis-insights"]');
if (panelEl) await panelEl.screenshot({ path: 'scripts/p3-shots/jarvis-insights-crop.png' });
results.screenshots = ['scripts/p3-shots/jarvis-insights-full.png', 'scripts/p3-shots/jarvis-insights-crop.png'];

const errors = [];
app.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 140)); });
app.on('pageerror', (e) => errors.push('PAGEERROR:' + String(e).slice(0, 140)));
await sleep(2000);
results.consoleErrors = errors.slice(-6);

console.log('RESULT ' + JSON.stringify(results, null, 1));
await browser.disconnect();
