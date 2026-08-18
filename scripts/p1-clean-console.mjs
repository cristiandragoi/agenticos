// Phase 1 acceptance — part 2: clean console capture (no intentional 4600
// fetch) + verify the Jarvis conversation reply from the real SSE turn.
import puppeteer from 'puppeteer-core';

const BASE = 'http://localhost:4000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = {};

// 1. Clean console capture on the jarvis page (app-driven fetches only).
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((p) => p.url().includes('file://')) || pages[0];
const consoleErrors = [];
const consoleWarns = [];
app.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200));
  if (m.type() === 'warning') consoleWarns.push(m.text().slice(0, 200));
});
app.on('pageerror', (e) => consoleErrors.push('PAGEERROR:' + String(e).slice(0, 200)));
await app.evaluate(() => { location.hash = '#/jarvis'; });
await sleep(8000);
results.cleanConsole = { errors: consoleErrors.slice(-8), warnings: consoleWarns.slice(-8) };

// 2. The conversation created by the acceptance stream turn + its reply.
const res = await fetch(BASE + '/api/jarvis/conversations', { signal: AbortSignal.timeout(5000) });
const convs = await res.json();
const list = Array.isArray(convs) ? convs : (convs.conversations || []);
const target = list.find((c) => String(c.id || c.conversationId || '').startsWith('conv-dd62cd08-'));
results.foundConversation = !!target;
if (target) {
  const mid = target.id || target.conversationId;
  const mres = await fetch(BASE + `/api/jarvis/conversations/${mid}/messages`, { signal: AbortSignal.timeout(5000) });
  const msgs = await mres.json();
  const arr = Array.isArray(msgs) ? msgs : (msgs.messages || []);
  const last = arr[arr.length - 1];
  results.messageCount = arr.length;
  results.lastMessage = last ? { role: last.role, text: String(last.text || last.content || '').slice(0, 120) } : null;
  results.replyContainsToken = !!last && /P1_BACKEND_OK/i.test(String(last.text || last.content || ''));
}
await browser.disconnect();
console.log('RESULT ' + JSON.stringify(results, null, 1));
