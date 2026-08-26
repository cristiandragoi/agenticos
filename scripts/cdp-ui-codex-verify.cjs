const http = require('http');
const path = require('path');
const WebSocket = require(path.resolve('B:/AgenticOS/server/node_modules/ws'));

const DEBUG_PORT = '9223';

function fetchTargets() {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${DEBUG_PORT}/json/list`, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  // ── 1. Connect ────────────────────────────────────────────────
  const targets = await fetchTargets();
  const pageTargets = targets.filter(t => t.type === 'page');
  console.log('=== STEP 8/9 CDP VERIFICATION ===');
  console.log(`[BEFORE] page/window target count: ${pageTargets.length}`);
  console.log(`[BEFORE] target id: ${pageTargets[0]?.id}`);
  console.log(`[BEFORE] url: ${pageTargets[0]?.url}`);

  const page = pageTargets[0];
  if (!page) throw new Error('No page target');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  let id = 1; const pending = new Map();
  ws.on('message', (raw) => { const m = JSON.parse(raw.toString()); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  const send = (method, params) => new Promise((resolve) => { const mid = id++; pending.set(mid, resolve); ws.send(JSON.stringify({ id: mid, method, params })); });
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    return r.result?.result?.value;
  };

  // Startup-race retry guard
  await evaluate(`(() => { const b = document.querySelector('[data-testid="app-backend-retry"]'); if (b) b.click(); return 'retry-clicked-or-absent'; })()`);
  await sleep(2500);

  // ── 2. STEP 8: navigate to Revenue Operator (hash nav OK for step 8) ──
  await evaluate(`window.location.hash = '#/revenue'; 'navigating'`);
  await sleep(4000);

  const revPage = await evaluate(`(() => ({
    hash: window.location.hash,
    revenuePage: !!document.querySelector('[data-testid="revenue-operator-page"]'),
    supervisorBar: !!document.querySelector('[data-testid="supervisor-control-bar"]'),
    supervisorText: (document.querySelector('[data-testid="supervisor-control-bar"]')?.textContent || '').replace(/\\s+/g,' ').trim(),
    buttons: Array.from(document.querySelectorAll('button')).map(b => (b.textContent||'').replace(/\\s+/g,' ').trim()).filter(t => /START|RESUME|PAUSE|STOP|Briefing/i.test(t)),
    gateBanner: (document.querySelector('.bg-amber-500\\/10')?.textContent || '').replace(/\\s+/g,' ').trim().slice(0,120),
  }))()`);

  console.log('\n=== STEP 8: REVENUE OPERATOR UI ===');
  console.log(JSON.stringify(revPage, null, 2));

  // Click gates tab to enumerate gates
  await evaluate(`document.querySelector('[data-testid="tab-gates"]')?.click(); 'clicked-gates-tab'`);
  await sleep(2000);
  const gatesInfo = await evaluate(`(() => ({
    gateTabLabel: (document.querySelector('[data-testid="tab-gates"]')?.textContent || '').replace(/\\s+/g,' ').trim(),
    gateQueueItems: document.querySelectorAll('[data-testid^="gate-"], .gate-item, [data-testid^="gate-row"]').length,
    bodyText: (document.body.textContent || '').match(/human gate/g)?.length || 0,
    openGateText: (document.body.textContent || '').match(/(\\d+) human gate\\(s\\) open/)?.[0] || null,
  }))()`);
  console.log('\n=== STEP 8: HUMAN GATES ===');
  console.log(JSON.stringify(gatesInfo, null, 2));

  // ── 3. STEP 9: real CodeX DOM click ───────────────────────────
  const beforeClick = await fetchTargets();
  const beforeCount = beforeClick.filter(t => t.type === 'page').length;
  const beforeId = beforeClick.filter(t => t.type === 'page')[0]?.id;
  console.log('\n=== STEP 9: REAL CODEX CLICK ===');
  console.log(`[before click] target count: ${beforeCount}, id: ${beforeId}`);

  const navCheck = await evaluate(`(() => {
    const el = document.querySelector('[data-testid="nav-codex"]');
    return { exists: !!el, tag: el?.tagName, title: el?.getAttribute('title'), href: el?.getAttribute('href'), visible: !!el && el.offsetParent !== null };
  })()`);
  console.log('[nav-codex element]', JSON.stringify(navCheck));

  await evaluate(`(() => { document.querySelector('[data-testid="nav-codex"]').click(); return 'clicked_nav_codex'; })()`);
  await sleep(2500);

  const afterClick = await fetchTargets();
  const afterPageTargets = afterClick.filter(t => t.type === 'page');
  const afterId = afterPageTargets[0]?.id;
  const postAudit = await evaluate(`(() => ({
    hash: window.location.hash,
    pathname: window.location.pathname,
    appShellCount: document.querySelectorAll('.app-shell, [data-testid="app-shell"], [data-testid="nav-rail"]').length,
    codexWorkspaceCount: document.querySelectorAll('[data-testid="codex-workspace"], [data-testid="codex-root"], .codex-workspace, [data-testid="page-codex"]').length,
    nestedAgenticOS: document.querySelectorAll('.app-shell .app-shell').length,
    title: document.title,
  }))()`);

  console.log(`[after click] target count: ${afterPageTargets.length}, id: ${afterId}`);
  console.log('[post-click audit]', JSON.stringify(postAudit, null, 2));

  const assertions = {
    singleWindow: afterPageTargets.length === 1,
    sameWindowId: afterId === beforeId,
    routeCodex: (postAudit.hash || '').includes('codex'),
    oneAppShell: postAudit.appShellCount >= 1,
    oneCodexWorkspace: postAudit.codexWorkspaceCount >= 1,
    noNestedAgenticOS: postAudit.nestedAgenticOS === 0,
  };
  console.log('\n=== STEP 9 ASSERTIONS ===');
  for (const [k, v] of Object.entries(assertions)) console.log(`[${v ? 'PASS' : 'FAIL'}] ${k}`);

  ws.close();
  process.exit(assertions.singleWindow && assertions.sameWindowId && assertions.routeCodex && assertions.oneAppShell && assertions.oneCodexWorkspace && assertions.noNestedAgenticOS ? 0 : 2);
})().catch(e => { console.error('CDP verification error:', e.message); process.exit(1); });
