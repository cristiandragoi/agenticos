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

async function startPackagedApp() {
  console.log('Launching Packaged App with remote debugging port 9222...');
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

async function closePackagedApp() {
  console.log('Closing Packaged App...');
  try {
    const cdp = await getCDP();
    await cdp.evaluate('window.ipcRenderer ? window.ipcRenderer.send("window-close") : window.close()');
    cdp.ws.close();
  } catch {
    try {
      execSync('powershell -Command "Get-Process | Where-Object { $_.ProcessName -like \'*Agentic*\' } | Stop-Process -Force"');
    } catch {}
  }
  await new Promise(r => setTimeout(r, 2000));
}

async function runGoalAndVerify(cdp, prompt, label) {
  console.log(`\n--- ${label} ---`);
  
  // Navigate to CodeX
  await cdp.evaluate('window.location.hash = "#/codex"');
  await new Promise(r => setTimeout(r, 1000));

  // Snapshot existing goals
  const beforeRes = await fetch('http://127.0.0.1:4000/api/chat/agents/goals');
  const beforeGoals = await beforeRes.json();
  const existingIds = new Set(beforeGoals.map(g => g.id));

  // Focus textarea
  await cdp.evaluate(`(() => {
    const textarea = document.querySelector('[data-testid="codex-composer"] textarea');
    if (textarea) {
      textarea.focus();
      textarea.value = '';
    }
  })()`);

  // Insert text via native CDP typing simulation
  await cdp.send('Input.insertText', { text: prompt });
  await new Promise(r => setTimeout(r, 500));

  // Click Send button
  await cdp.evaluate(`(() => {
    const buttons = Array.from(document.querySelectorAll('[data-testid="codex-composer"] button'));
    const sendBtn = buttons.find(b => b.innerText.includes('Send'));
    if (!sendBtn) throw new Error("Send button not found");
    sendBtn.click();
  })()`);

  console.log('Clicked Send button in UI. Waiting for goal creation & execution...');

  // Find newly created goal
  let goalId = null;
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const res = await fetch('http://127.0.0.1:4000/api/chat/agents/goals');
    const goals = await res.json();
    const newGoal = goals.find(g => !existingIds.has(g.id));
    if (newGoal) {
      goalId = newGoal.id;
      break;
    }
  }

  if (!goalId) throw new Error('New goal was not created in database');
  console.log(`Identified NEW Goal ID: ${goalId}`);

  // Wait for execution to complete
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 1500));
    const res = await fetch(`http://127.0.0.1:4000/api/chat/agents/goal/${goalId}`);
    const fullGoal = await res.json();
    const events = fullGoal.history || [];
    console.log(`[T+${(i+1)*1.5}s] Status: ${fullGoal.status}, Events: ${events.length}`);

    if (fullGoal.status === 'waiting_for_approval') {
      console.log('Goal waiting for approval, approving...');
      await fetch(`http://127.0.0.1:4000/api/chat/agents/goal/${goalId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve' })
      });
    }

    if (fullGoal.status === 'completed') {
      const summary = fullGoal.runSummary?.finalAnswer || fullGoal.runSummary?.message || '';
      console.log(`[PASS] Goal ${goalId} completed successfully! Events: ${events.length}`);
      console.log(`Result: ${summary.slice(0, 150)}...`);
      return { goalId, status: fullGoal.status, eventsCount: events.length, finalAnswer: summary };
    }

    if (fullGoal.status === 'failed') {
      throw new Error(`Goal ${goalId} failed during execution: ${JSON.stringify(events[events.length - 1] || {})}`);
    }
  }

  throw new Error(`Goal ${goalId} timed out`);
}

async function main() {
  console.log('=== REAL GUI CODEX CONTROL & RESTART EXECUTION TESTS ===');

  // Kill existing instances
  try {
    execSync('powershell -Command "Get-Process | Where-Object { $_.ProcessName -like \'*Agentic*\' } | Stop-Process -Force"');
  } catch {}
  await new Promise(r => setTimeout(r, 1000));

  await startPackagedApp();
  let cdp = await getCDP();

  // Clear stale localStorage
  await cdp.evaluate('window.localStorage.removeItem("agenticos:codex-run-settings")');

  // 1. Control Test 1
  const t1 = await runGoalAndVerify(
    cdp,
    'READ-ONLY: Inspect B:\\AgenticOS\\package.json and tell me the project name.',
    'CONTROL TEST 1: Root package.json'
  );

  // 2. Control Test 2
  const t2 = await runGoalAndVerify(
    cdp,
    'READ-ONLY: Inspect B:\\AgenticOS\\server\\package.json and tell me the project name.',
    'CONTROL TEST 2: Server package.json'
  );

  cdp.ws.close();

  // 3. Restart Test
  console.log('\n--- RESTARTING AGENTIC OS (NORMAL CLOSE & REOPEN) ---');
  await closePackagedApp();
  await startPackagedApp();

  cdp = await getCDP();

  // 4. Post-Restart Test
  const t3 = await runGoalAndVerify(
    cdp,
    'READ-ONLY: Inspect B:\\AgenticOS\\package.json and tell me the project name.',
    'POST-RESTART TEST: Root package.json after restart'
  );

  cdp.ws.close();

  console.log('\n=== ALL 3 TESTS PASSED PERFECTLY ===');
  console.log(JSON.stringify({ t1, t2, t3 }, null, 2));
}

main().catch(err => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
