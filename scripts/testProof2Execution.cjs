const WebSocket = require('ws');
const { execSync } = require('child_process');
const fs = require('fs');

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

async function main() {
  console.log('=== REAL CODEX PROOF 2 EXECUTION TEST ===\n');

  // Clean previous target file if exists
  const targetPath = 'B:/AgenticOS/scratch/codex_proof_2.txt';
  if (fs.existsSync(targetPath)) {
    fs.unlinkSync(targetPath);
  }

  // Kill existing instances
  try {
    execSync('powershell -Command "Get-Process | Where-Object { $_.ProcessName -like \'*Agentic*\' } | Stop-Process -Force"');
  } catch {}
  await new Promise(r => setTimeout(r, 1000));

  await startPackagedApp();
  const cdp = await getCDP();

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
      textarea.click();
    }
  })()`);
  await new Promise(r => setTimeout(r, 300));

  const prompt = 'Create B:\\AgenticOS\\scratch\\codex_proof_2.txt with exact content CODEX SECOND PROOF PASS then read it back and verify it.';

  // Type characters using CDP keyboard events
  for (const char of prompt) {
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', text: char, unmodifiedText: char });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp' });
  }

  await new Promise(r => setTimeout(r, 500));

  // Submit via Enter key
  console.log('Dispatching Enter key...');
  await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', windowsVirtualKeyCode: 13, unmodifiedText: '\r', text: '\r' });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', windowsVirtualKeyCode: 13 });

  // Also click Send button
  await cdp.evaluate(`(() => {
    const buttons = Array.from(document.querySelectorAll('[data-testid="codex-composer"] button'));
    const sendBtn = buttons.find(b => b.innerText.includes('Send'));
    if (sendBtn && !sendBtn.disabled) sendBtn.click();
  })()`);

  console.log('Submitted goal via UI. Waiting for goal creation & execution...');

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

    if (fullGoal.status === 'completed') {
      const summary = fullGoal.runSummary?.finalAnswer || fullGoal.runSummary?.message || '';
      console.log(`\n[PASS] Goal ${goalId} completed successfully! Events: ${events.length}`);
      console.log(`Result: ${summary}`);

      // Verify physical file
      console.log('\n--- VERIFYING PHYSICAL FILE ---');
      const exists = fs.existsSync(targetPath);
      console.log('File exists:', exists);
      if (!exists) throw new Error('Physical file does not exist!');

      const content = fs.readFileSync(targetPath, 'utf8');
      console.log('Physical file content:', JSON.stringify(content));
      const contentTrimmed = content.trim();
      if (!contentTrimmed.includes('CODEX SECOND PROOF PASS')) {
        throw new Error(`Physical file content mismatch: "${content}"`);
      }
      console.log('[PASS] Content verified: "CODEX SECOND PROOF PASS"');

      // Check tool steps in DB
      const dbStepsRes = await fetch(`http://127.0.0.1:4000/api/chat/agents/goal/${goalId}/steps`);
      const dbSteps = await dbStepsRes.json();
      console.log('\n--- VERIFYING TOOL STEPS ---');
      console.log(JSON.stringify(dbSteps, null, 2));

      cdp.ws.close();
      return {
        goalId,
        status: fullGoal.status,
        eventsCount: events.length,
        stepsCount: dbSteps.length,
        physicalFileExists: true,
        physicalFileContent: content,
        finalAnswer: summary
      };
    }

    if (fullGoal.status === 'failed') {
      throw new Error(`Goal ${goalId} failed during execution: ${JSON.stringify(events[events.length - 1] || {})}`);
    }
  }

  throw new Error(`Goal ${goalId} timed out`);
}

main().then(res => {
  console.log('\n=== TEST SUCCESSFUL ===');
  console.log(JSON.stringify(res, null, 2));
  process.exit(0);
}).catch(err => {
  console.error('Test Failed:', err);
  process.exit(1);
});
