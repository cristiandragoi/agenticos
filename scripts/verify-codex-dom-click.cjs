const http = require('http');
const path = require('path');
const WebSocket = require(path.resolve(__dirname, '../server/node_modules/ws'));

// ATTACH MODE: connects to the EXISTING packaged Electron instance via CDP.
// It does NOT launch another Electron instance (single-instance lock would
// otherwise abort the second spawn). It does NOT close the app afterward.
console.log('=== REAL PACKAGED CODEX DOM CLICK VERIFIER (ATTACH, CDP) ===\n');

const DEBUG_PORT = process.env.AGENTICOS_ELECTRON_REMOTE_DEBUGGING_PORT || '9223';

function fetchTargets() {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${DEBUG_PORT}/json/list`, (res) => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const targets = await fetchTargets();
  const pageTargets = targets.filter(t => t.type === 'page');
  if (pageTargets.length === 0) throw new Error('No page target on CDP ' + DEBUG_PORT + ' — packaged app not running?');
  const primary = pageTargets[0];
  console.log(`[1/5] Attached to existing packaged Electron window:`);
  console.log(`- page/window target count: ${pageTargets.length}`);
  console.log(`- target ID: ${primary.id}`);
  console.log(`- url: ${primary.url}`);

  const ws = new WebSocket(primary.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  let id = 1; const pending = new Map();
  ws.on('message', (raw) => { const m = JSON.parse(raw.toString()); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  const send = (method, params) => new Promise((resolve) => { const mid = id++; pending.set(mid, resolve); ws.send(JSON.stringify({ id: mid, method, params })); });
  const evalv = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result?.result?.value;

  console.log('\n[2/5] Inspecting [data-testid="nav-codex"]...');
  let nav = null;
  for (let i = 0; i < 40; i++) {
    nav = await evalv(`(() => { const el = document.querySelector('[data-testid="nav-codex"]'); return el ? { exists: true, tag: el.tagName, title: el.getAttribute('title'), href: el.getAttribute('href'), visible: !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length) } : { exists: false }; })()`);
    if (nav && nav.exists) break;
    await sleep(500);
  }
  console.log('- nav-codex:', JSON.stringify(nav));
  if (!nav || !nav.exists) throw new Error('[data-testid="nav-codex"] not found.');

  console.log('\n[3/5] Performing REAL DOM click on [data-testid="nav-codex"]...');
  const clickRes = await evalv(`(() => { const el = document.querySelector('[data-testid="nav-codex"]'); el.click(); return 'clicked:' + (el.getAttribute('title') || 'nav-codex'); })()`);
  console.log('- click result:', clickRes);
  await sleep(2500);

  console.log('\n[4/5] Window + DOM state AFTER click:');
  const afterTargets = await fetchTargets();
  const afterPage = afterTargets.filter(t => t.type === 'page');
  const audit = await evalv(`(() => ({
    hash: window.location.hash,
    appShellCount: document.querySelectorAll('.app-shell').length,
    codexWorkspaceCount: document.querySelectorAll('[data-testid="codex-workspace"]').length,
    navCodexCount: document.querySelectorAll('[data-testid="nav-codex"]').length,
    title: document.title
  }))()`);
  console.log(`- page/window target count after: ${afterPage.length}`);
  console.log(`- target ID after: ${afterPage[0]?.id} (same=${afterPage[0]?.id === primary.id})`);
  console.log(`- route hash: ${audit.hash}`);
  console.log(`- .app-shell count: ${audit.appShellCount}`);
  console.log(`- [data-testid="codex-workspace"] count: ${audit.codexWorkspaceCount}`);

  const checks = [
    ['page/window target count === 1', afterPage.length === 1],
    ['same target ID preserved (no second window)', afterPage[0]?.id === primary.id],
    ['route became #/codex', (audit.hash || '').includes('codex')],
    ['exactly one AppShell', audit.appShellCount === 1],
    ['exactly one CodeX workspace', audit.codexWorkspaceCount === 1],
  ];
  console.log('\n[5/5] Assertions:');
  let ok = true;
  for (const [label, pass] of checks) { console.log(`- [${pass ? 'PASS' : 'FAIL'}] ${label}`); if (!pass) ok = false; }

  ws.close();
  if (!ok) { console.error('\nPACKAGED CODEX CLICK VERIFICATION: FAILED'); process.exit(1); }
  console.log('\nPACKAGED CODEX CLICK VERIFICATION: PASSED (attached; app left running)');
  process.exit(0);
})().catch(e => { console.error('CodeX attach verifier error:', e.message); process.exit(1); });
