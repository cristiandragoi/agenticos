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

async function main() {
  console.log('=== CODEX RESULT PRESENTATION ACCEPTANCE TEST ===\n');

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

  const prompt = 'READ-ONLY: Inspect B:\\AgenticOS and identify ONE functional feature we should build next. Return a concise recommendation.';

  // Type characters
  for (const char of prompt) {
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', text: char, unmodifiedText: char });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp' });
  }
  await new Promise(r => setTimeout(r, 500));

  // Submit via Enter key
  await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', windowsVirtualKeyCode: 13, unmodifiedText: '\r', text: '\r' });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', windowsVirtualKeyCode: 13 });

  // Fallback click send
  await cdp.evaluate(`(() => {
    const buttons = Array.from(document.querySelectorAll('[data-testid="codex-composer"] button'));
    const sendBtn = buttons.find(b => b.innerText.includes('Send'));
    if (sendBtn && !sendBtn.disabled) sendBtn.click();
  })()`);

  console.log('Submitted prompt via UI...');

  // Identify newly created goal
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

  if (!goalId) throw new Error('Goal was not created');
  console.log(`Identified Goal ID: ${goalId}`);

  // Wait for completion
  let completedGoal = null;
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 1500));
    const res = await fetch(`http://127.0.0.1:4000/api/chat/agents/goal/${goalId}`);
    const g = await res.json();
    console.log(`[T+${(i+1)*1.5}s] Status: ${g.status}, Events: ${g.history?.length || 0}`);
    if (g.status === 'completed') {
      completedGoal = g;
      break;
    }
    if (g.status === 'failed') {
      throw new Error(`Goal failed: ${JSON.stringify(g.history?.slice(-1)[0] || {})}`);
    }
  }

  if (!completedGoal) throw new Error('Goal timed out');

  // Let UI render
  await new Promise(r => setTimeout(r, 2000));

  // Check DOM for FINAL RESULT card and rendered markdown
  const domCheck = await cdp.evaluate(`(() => {
    const resultCard = document.querySelector('[data-testid="codex-final-result-card"]');
    const resultText = resultCard?.innerText || '';
    const timeline = document.querySelector('[data-testid="codex-timeline"]');
    const timelineEventsCount = timeline ? timeline.querySelectorAll('.group').length : 0;
    const summaryCard = document.querySelector('[data-testid="codex-final-summary"]');
    const summaryText = summaryCard?.innerText || '';

    return {
      resultCardExists: !!resultCard,
      resultTextLength: resultText.length,
      resultTextSnippet: resultText.slice(0, 200),
      timelineEventsCount,
      summaryTextSnippet: summaryText.slice(0, 150)
    };
  })()`);

  console.log('\n--- DOM VERIFICATION AFTER COMPLETION ---');
  console.log(JSON.stringify(domCheck, null, 2));

  if (!domCheck.resultCardExists || domCheck.resultTextLength < 20) {
    throw new Error('FINAL RESULT card is missing or empty in DOM');
  }

  // TEST HISTORICAL GOAL SELECTION:
  // Switch to another goal or deselect, then select this goal again from Recent Goals
  console.log('\n--- TESTING HISTORICAL GOAL HYDRATION ---');
  await cdp.evaluate(`(() => {
    const newBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('New Task'));
    if (newBtn) newBtn.click();
  })()`);
  await new Promise(r => setTimeout(r, 1000));

  // Click this goal in Recent Goals list
  await cdp.evaluate(`(() => {
    const goalBtns = Array.from(document.querySelectorAll('[data-testid="codex-recent-goals"] button'));
    const targetBtn = goalBtns.find(b => b.innerText.includes(${JSON.stringify(goalId)}));
    if (targetBtn) targetBtn.click();
  })()`);
  await new Promise(r => setTimeout(r, 2000));

  const domCheckHistorical = await cdp.evaluate(`(() => {
    const resultCard = document.querySelector('[data-testid="codex-final-result-card"]');
    const resultText = resultCard?.innerText || '';
    return {
      resultCardExists: !!resultCard,
      resultTextLength: resultText.length,
      resultTextSnippet: resultText.slice(0, 200)
    };
  })()`);

  console.log('\n--- DOM VERIFICATION AFTER HISTORICAL SELECTION ---');
  console.log(JSON.stringify(domCheckHistorical, null, 2));

  if (!domCheckHistorical.resultCardExists || domCheckHistorical.resultTextLength < 20) {
    throw new Error('Historical goal selection failed to render FINAL RESULT card');
  }

  console.log('\n=== ALL PRESENTATION CHECKS PASSED PERFECTLY ===');
  cdp.ws.close();
}

main().catch(err => {
  console.error('Acceptance Test Failed:', err);
  process.exit(1);
});
