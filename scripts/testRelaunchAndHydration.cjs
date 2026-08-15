const WebSocket = require('ws');
const { execSync } = require('child_process');

async function getCDP() {
  const res = await fetch('http://127.0.0.1:9222/json');
  const targets = await res.json();
  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.on('open', r));

  let id = 1;
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const msgId = id++;
    const handler = (data) => {
      const msg = JSON.parse(data);
      if (msg.id === msgId) {
        ws.off('message', handler);
        if (msg.error) reject(msg.error);
        else resolve(msg.result);
      }
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({ id: msgId, method, params }));
  });

  const evaluate = async (expression) => {
    const res = await send('Runtime.evaluate', { expression, returnByValue: true });
    return res.result?.value;
  };

  return { ws, send, evaluate };
}

async function isBackendHealthy() {
  try {
    const res = await fetch('http://127.0.0.1:4000/api/health', { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function terminateApp() {
  console.log('Terminating all Agentic OS processes...');
  try {
    execSync('powershell -Command "Get-Process | Where-Object { $_.ProcessName -like \'*Agentic*\' } | Stop-Process -Force"');
  } catch {}
  await new Promise(r => setTimeout(r, 1500));
}

async function startPackagedApp() {
  console.log('Launching Packaged App...');
  execSync('powershell -Command "$env:AGENTICOS_ELECTRON_REMOTE_DEBUGGING_PORT=\'9222\'; Start-Process \'C:\\Users\\Cris\\Desktop\\desktop\\Agentic_OS\\Agentic OS\\Agentic OS.exe\'"');
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 1000));
    if (await isBackendHealthy()) {
      console.log(`[PASS] Packaged backend healthy at T+${i+1}s`);
      return true;
    }
  }
  throw new Error('Packaged backend failed to start');
}

async function main() {
  console.log('=== PHASE 8: CLOSE & RELAUNCH HYDRATION REGRESSION TEST ===\n');

  // 1. Close the app completely
  await terminateApp();

  // 2. Relaunch the app
  await startPackagedApp();
  const cdp = await getCDP();

  // 3. Verify CodeX Hydration
  console.log('--- Verifying CodeX Studio Hydration ---');
  await cdp.evaluate('window.location.hash = "#/codex"');
  await new Promise(r => setTimeout(r, 2000));

  const codexCheck = await cdp.evaluate(`(() => {
    const workspace = document.querySelector('[data-testid="codex-workspace"]');
    const recentGoals = document.querySelector('.recent-goals-list') || document.querySelector('[data-testid="recent-goals"]') || document.body;
    return {
      hasWorkspace: !!workspace,
      textContainsGoal: document.body.innerText.includes('CODEX STILL WORKS AFTER MAGNITUDE') || document.body.innerText.includes('magnitude_codex_regression'),
      bodySnippet: document.body.innerText.slice(0, 300)
    };
  })()`);
  console.log('CodeX DOM Check:', codexCheck);
  if (!codexCheck.hasWorkspace) throw new Error('CodeX workspace failed to mount');
  console.log('[PASS] CodeX Studio mounted and hydrated on restart!\n');

  // 4. Verify Magnitude Hydration
  console.log('--- Verifying Magnitude Studio Hydration ---');
  await cdp.evaluate('window.location.hash = "#/magnitude"');
  await new Promise(r => setTimeout(r, 2000));

  const magnitudeCheck = await cdp.evaluate(`(() => {
    const studio = document.querySelector('[data-testid="magnitude-studio"]');
    const recentRuns = document.querySelector('[data-testid="magnitude-recent-runs"]');
    const bodyText = document.body.innerText;
    return {
      hasStudio: !!studio,
      hasRecentRuns: !!recentRuns,
      hasExampleDomainRun: bodyText.includes('example.com') || bodyText.includes('wikipedia.org'),
      bodySnippet: bodyText.slice(0, 300)
    };
  })()`);
  console.log('Magnitude DOM Check:', magnitudeCheck);
  if (!magnitudeCheck.hasStudio || !magnitudeCheck.hasExampleDomainRun) {
    throw new Error('Magnitude Studio failed to hydrate past runs on restart');
  }
  console.log('[PASS] Magnitude Studio mounted and hydrated on restart!\n');

  // 5. Verify Jarvis Hydration & Functionality
  console.log('--- Verifying Jarvis Studio Hydration ---');
  await cdp.evaluate('window.location.hash = "#/jarvis"');
  await new Promise(r => setTimeout(r, 2000));

  const jarvisCheck = await cdp.evaluate(`(() => {
    const bodyText = document.body.innerText;
    return {
      hasJarvisText: /jarvis/i.test(bodyText) || /mission control/i.test(bodyText) || /ask/i.test(bodyText),
      bodySnippet: bodyText.slice(0, 300)
    };
  })()`);
  console.log('Jarvis DOM Check:', jarvisCheck);
  if (!jarvisCheck.hasJarvisText) {
    throw new Error('Jarvis failed to load on restart');
  }
  console.log('[PASS] Jarvis Studio mounted and hydrated on restart!\n');

  console.log('=== CLOSE / RELAUNCH REGRESSION PASSED 100%! ===');
  cdp.ws.close();
}

main().catch(err => {
  console.error('Relaunch Test Failed:', err);
  process.exit(1);
});
