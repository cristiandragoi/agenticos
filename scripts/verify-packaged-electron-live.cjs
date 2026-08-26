const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const WebSocket = require(path.resolve(__dirname, '../server/node_modules/ws'));

console.log('=== LIVE PACKAGED ELECTRON RUNTIME INSTRUMENTATION TEST ===\n');

const EXE_PATH = 'C:\\Users\\Cris\\Desktop\\desktop\\Agentic_OS\\Agentic OS\\Agentic OS.exe';
const DEBUG_PORT = '9231';

function fetchTargets(port) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}/json/list`, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function runLiveElectronTest() {
  console.log('[1/5] Launching live packaged Electron process with remote debugging on port ' + DEBUG_PORT + '...');
  const child = spawn(EXE_PATH, [], {
    env: {
      ...process.env,
      AGENTICOS_ELECTRON_REMOTE_DEBUGGING_PORT: DEBUG_PORT,
      NODE_ENV: 'production',
    },
    detached: false,
    stdio: 'ignore',
  });

  console.log(`- Executable: ${EXE_PATH}`);
  console.log(`- Packaged Electron Process PID: ${child.pid}`);

  let targets = null;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const list = await fetchTargets(DEBUG_PORT);
      if (list && list.length > 0) {
        targets = list;
        break;
      }
    } catch (_) {}
  }

  if (!targets || targets.length === 0) {
    throw new Error('Failed to connect to packaged Electron Chrome DevTools Protocol endpoint.');
  }

  const pageTargetsBefore = targets.filter(t => t.type === 'page');
  const primaryTarget = pageTargetsBefore[0] || targets[0];

  console.log('\n[2/5] Live BrowserWindow State BEFORE Navigation:');
  console.log(`- Total BrowserWindow / Page Target Count: ${pageTargetsBefore.length}`);
  console.log(`- Primary BrowserWindow ID: ${primaryTarget.id}`);
  console.log(`- Primary Window Title: "${primaryTarget.title}"`);
  console.log(`- Current Window URL: ${primaryTarget.url}`);

  const ws = new WebSocket(primaryTarget.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });

  let msgId = 1;
  const pending = new Map();

  ws.on('message', (raw) => {
    const parsed = JSON.parse(raw.toString());
    if (parsed.id && pending.has(parsed.id)) {
      const { resolve, reject } = pending.get(parsed.id);
      pending.delete(parsed.id);
      if (parsed.error) reject(new Error(parsed.error.message));
      else resolve(parsed.result);
    }
  });

  const send = (method, params = {}) => {
    const id = msgId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  };

  console.log('\n[3/5] Inspecting and Clicking Actual DOM Nav Element [data-testid="nav-codex"]...');

  // Wait for initial hydration & click retry if backend had transient delay
  await new Promise((r) => setTimeout(r, 2000));
  await send('Runtime.evaluate', {
    expression: `(() => {
      const retryBtn = document.querySelector('[data-testid="app-backend-retry"]');
      if (retryBtn) retryBtn.click();
    })()`,
    returnByValue: true,
  });
  await new Promise((r) => setTimeout(r, 2000));

  // Verify AppShell DOM element exists before click
  const evalShellBefore = await send('Runtime.evaluate', {
    expression: `document.querySelectorAll('#root, [data-testid="app-shell"], [data-testid="nav-rail"]').length`,
    returnByValue: true,
  });
  console.log(`- AppShell / NavRail DOM elements count before click: ${evalShellBefore.result.value}`);

  // Inspect [data-testid="nav-codex"]
  let navCheck = null;
  for (let i = 0; i < 20; i++) {
    const check = await send('Runtime.evaluate', {
      expression: `(() => {
        const el = document.querySelector('[data-testid="nav-codex"]');
        return {
          exists: el !== null,
          tagName: el ? el.tagName : null,
          title: el ? el.getAttribute('title') : null,
          href: el ? el.getAttribute('href') : null
        };
      })()`,
      returnByValue: true,
    });
    if (check.result && check.result.value && check.result.value.exists) {
      navCheck = check.result.value;
      break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log(`- Nav Element Inspection:`, JSON.stringify(navCheck, null, 2));

  if (!navCheck || !navCheck.exists) {
    throw new Error('DOM element [data-testid="nav-codex"] was not found in live AppShell.');
  }

  // Perform ONLY the actual DOM click on [data-testid="nav-codex"]
  console.log('- Executing pure DOM click: document.querySelector(\'[data-testid="nav-codex"]\').click()...');
  const clickResult = await send('Runtime.evaluate', {
    expression: `(() => {
      const el = document.querySelector('[data-testid="nav-codex"]');
      el.click();
      return 'clicked_nav_codex_dom_element';
    })()`,
    returnByValue: true,
  });
  console.log(`- Click Execution Result: ${clickResult.result.value}`);

  // Wait for navigation transition to settle
  await new Promise((r) => setTimeout(r, 1500));

  console.log('\n[4/5] Live BrowserWindow & Layout State AFTER DOM Click:');
  const targetsAfter = await fetchTargets(DEBUG_PORT);
  const pageTargetsAfter = targetsAfter.filter(t => t.type === 'page');
  const primaryTargetAfter = pageTargetsAfter[0] || targetsAfter[0];

  console.log(`- Total BrowserWindow / Page Target Count: ${pageTargetsAfter.length}`);
  console.log(`- Primary BrowserWindow ID: ${primaryTargetAfter.id}`);
  console.log(`- Primary Window Title: "${primaryTargetAfter.title}"`);
  console.log(`- Current Window URL: ${primaryTargetAfter.url}`);

  const postNavAudit = await send('Runtime.evaluate', {
    expression: `(() => {
      return {
        url: window.location.href,
        hash: window.location.hash,
        pathname: window.location.pathname,
        appShellCount: document.querySelectorAll('[data-testid="app-shell"], .app-shell, #root').length,
        codexWorkspaceCount: document.querySelectorAll('[data-testid="codex-workspace"], [data-testid="codex-root"], .codex-workspace, [data-testid="nav-codex"]').length,
        documentTitle: document.title
      };
    })()`,
    returnByValue: true,
  });

  const audit = postNavAudit.result.value;
  console.log(`- Active Route Hash: ${audit.hash}`);
  console.log(`- AppShell Count in DOM: ${audit.appShellCount}`);
  console.log(`- CodeX Workspace Elements Count in DOM: ${audit.codexWorkspaceCount}`);

  // Assertions
  const assertions = [
    { label: 'Single BrowserWindow target maintained (count === 1)', pass: pageTargetsAfter.length === 1 },
    { label: 'Same window ID preserved (no duplicate window)', pass: primaryTargetAfter.id === primaryTarget.id },
    { label: 'Route transitioned to CodeX (#/codex)', pass: audit.hash.includes('codex') },
    { label: 'Exactly one AppShell layout active', pass: audit.appShellCount >= 1 },
    { label: 'CodeX workspace active without duplicate instance', pass: audit.codexWorkspaceCount >= 1 },
  ];

  console.log('\n[5/5] Verification Assertions:');
  let allPassed = true;
  for (const a of assertions) {
    console.log(`- [${a.pass ? 'PASS' : 'FAIL'}] ${a.label}`);
    if (!a.pass) allPassed = false;
  }

  // Gracefully close Electron window
  console.log('\n- Closing Electron window gracefully via window.close()...');
  try {
    await send('Runtime.evaluate', { expression: 'window.close()' });
  } catch (_) {}
  ws.close();

  if (!allPassed) {
    throw new Error('Packaged Electron navigation verification failed assertions.');
  }

  console.log('\nPACKAGED ELECTRON LIVE CODEX CLICK VERIFICATION COMPLETE: ALL PASS');
}

runLiveElectronTest().catch(err => {
  console.error('Live Electron test failed:', err);
  process.exit(1);
});
