// Phase 1 acceptance — backend/electron connection fix (canonical port 4000).
// Flow: CDP attach to running Electron → renderer checks on file:// origin →
// real Jarvis SSE chat turn → report.
import puppeteer from 'puppeteer-core';

const BASE = 'http://localhost:4000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function j(path, opts) {
  const res = await fetch(BASE + path, opts);
  let body = null;
  try { body = await res.json(); } catch {}
  return { status: res.status, body };
}

const results = {};

// ── 1. Renderer (CDP) checks ───────────────────────────────────────────
let browser;
try {
  browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
} catch (e) {
  results.cdp = { error: String(e).slice(0, 200) };
}
if (browser) {
  const pages = await browser.pages();
  const app = pages.find((p) => p.url().includes('file://')) || pages[0];
  const targets = await browser.targets();
  const tgt = targets.find((t) => t.type() === 'page' && t.url().includes('file://'));
  const cdp = tgt ? await tgt.createCDPSession() : null;
  if (cdp) await cdp.send('Page.enable');

  const consoleErrors = [];
  app.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
  app.on('pageerror', (e) => consoleErrors.push('PAGEERROR:' + String(e).slice(0, 200)));

  await app.evaluate(() => { location.hash = '#/jarvis'; });
  await sleep(5000);

  const probe = await app.evaluate(async () => {
    const out = { protocol: window.location.protocol, href: window.location.href.slice(0, 80) };
    try {
      const r = await fetch('http://localhost:4000/api/health', { signal: AbortSignal.timeout(4000) });
      const d = await r.json();
      out.health4000 = { ok: r.ok, status: d.status, version: d.version };
    } catch (e) { out.health4000 = { error: String(e).slice(0, 120) }; }
    try {
      const r = await fetch('http://localhost:4600/api/health', { signal: AbortSignal.timeout(3000) });
      out.health4600 = { ok: r.ok, status: r.status };
    } catch (e) { out.health4600 = { error: String(e).slice(0, 120) }; }
    try {
      const r = await fetch('http://localhost:4000/api/jarvis/runtime-state', { signal: AbortSignal.timeout(4000) });
      const d = await r.json();
      out.runtimeState4000 = { ok: r.ok, state: d.state };
    } catch (e) { out.runtimeState4000 = { error: String(e).slice(0, 120) }; }
    const chip = document.querySelector('[data-testid="backend-status-chip"]');
    out.statusChip = chip ? chip.textContent.trim().slice(0, 120) : null;
    return out;
  });
  results.renderer = probe;
  await sleep(1500);
  results.renderer.consoleErrors = consoleErrors.slice(-10);
  await browser.disconnect();
}

// ── 2. Jarvis API: create conversation + real SSE chat turn ───────────
const stamp = Date.now().toString(36).slice(-5);
const conv = await j('/api/jarvis/conversations', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: `P1 acceptance ${stamp}` }),
});
results.createConversation = { status: conv.status, id: conv.body?.id || conv.body?.conversation?.id || conv.body?.conversationId };
const convId = results.createConversation.id;
if (convId) {
  const op = 'p1-' + stamp;
  const streamStart = Date.now();
  const sse = await fetch(BASE + `/api/jarvis/conversations/${convId}/message/stream`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: 'Reply with exactly: P1_BACKEND_OK', operationId: op }),
  });
  results.stream = { httpStatus: sse.status, contentType: sse.headers.get('content-type') };
  const text = await sse.text();
  results.stream.durationMs = Date.now() - streamStart;
  const lines = text.split('\n').filter(Boolean);
  results.stream.eventCount = lines.length;
  results.stream.hasCompletion = /complete|done|finished|P1_BACKEND_OK/i.test(text);
  results.stream.sample = lines.slice(0, 4).map((l) => l.slice(0, 160));
  results.stream.containsPayload = text.includes('P1_BACKEND_OK');
  results.stream.tail = lines.slice(-3).map((l) => l.slice(0, 160));
}

// ── 3. Backend-side Jarvis diagnostics ────────────────────────────────
const rt = await j('/api/jarvis/runtime-state');
results.runtimeState = { state: rt.body?.state, provider: rt.body?.provider, model: rt.body?.model };
const convs = await j('/api/jarvis/conversations');
results.conversations = { status: convs.status, count: Array.isArray(convs.body) ? convs.body.length : (Array.isArray(convs.body?.conversations) ? convs.body.conversations.length : -1) };

console.log('RESULT ' + JSON.stringify(results, null, 1));
