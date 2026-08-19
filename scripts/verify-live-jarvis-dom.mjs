// Verify live deployed JARVIS DOM matches the screenshot: stage size, canvas size, testids, status chips.
import { spawn } from 'node:child_process';

const CDP_PORT = 9223; // AgenticOS Electron remote debugging
const APP = 'Agentic OS';

async function main() {
  // 1) Confirm app + debugging port
  const { execSync } = await import('node:child_process');
  let procs = '';
  try { procs = execSync('tasklist').toString(); } catch { /* ignore */ }
  const appRunning = /Agentic OS\.exe/i.test(procs);
  console.log('Agentic OS.exe running:', appRunning);

  // 2) Find the CDP target on the debugging port
  let targets = null;
  try {
    const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json`);
    targets = await res.json();
  } catch (e) {
    console.log('CDP fetch error:', e.message);
  }
  if (!targets) return;

  const pages = targets.filter((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  console.log('CDP pages:', pages.map((p) => ({ title: p.title, url: p.url })));

  // 3) Connect to the first page, evaluate DOM snapshot
  if (!pages.length) return;
  const ws = new WebSocket(pages[0].webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  };
  const send = (method, params = {}) => new Promise((resolve) => {
    const mid = ++id;
    pending.set(mid, resolve);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  await new Promise((r) => ws.onopen = r);

  const expr = `(() => {
    const stage = document.querySelector('[data-testid="jarvis-stage"]');
    const canvas = document.querySelector('[data-testid="jarvis-neural-canvas"]');
    const wordmark = document.querySelector('.wordmark, [class*="wordmark"]');
    const status = [...document.querySelectorAll('[data-testid="jarvis-status-strip"] > *')].map((e) => e.textContent.trim());
    const repo = document.querySelector('input[placeholder*="repository"]');
    const ready = document.body.innerText.includes('No git repository found at this path');
    return {
      stage: stage ? { rect: stage.getBoundingClientRect().toJSON() } : null,
      canvas: canvas ? { rect: canvas.getBoundingClientRect().toJSON(), aria: canvas.getAttribute('aria-label') } : null,
      wordmark: wordmark ? wordmark.textContent : null,
      statusChips: status,
      repoPlaceholder: repo ? repo.placeholder : null,
      repoWarningVisible: ready,
      bodyTextLen: document.body.innerText.length,
    };
  })()`;

  const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
  console.log('DOM SNAPSHOT:', JSON.stringify(res.result?.result?.value ?? res, null, 2));
  ws.close();
}

main().catch((e) => { console.error('ERR', e); process.exit(1); });
