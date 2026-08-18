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
  console.log('=== MAGNITUDE PACKAGED APP UI ACCEPTANCE TEST ===\n');

  try {
    execSync('powershell -Command "Get-Process | Where-Object { $_.ProcessName -like \'*Agentic*\' } | Stop-Process -Force"');
  } catch {}
  await new Promise(r => setTimeout(r, 1000));

  await startPackagedApp();
  const cdp = await getCDP();

  // Navigate to Magnitude Studio
  await cdp.evaluate('window.location.hash = "#/magnitude"');
  await new Promise(r => setTimeout(r, 1500));

  // Click quick target: example.com
  console.log('Clicking example.com quick target chip...');
  await cdp.evaluate(`(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const exBtn = buttons.find(b => b.innerText.includes('example.com'));
    if (exBtn) exBtn.click();
  })()`);
  await new Promise(r => setTimeout(r, 500));

  // Click Inspect button
  console.log('Clicking Inspect button...');
  await cdp.evaluate(`(() => {
    const btn = document.querySelector('[data-testid="magnitude-run-btn"]');
    if (btn) btn.click();
  })()`);

  // Wait for run completion
  console.log('Waiting for browser inspection and DOM rendering...');
  let completed = false;
  let resultData = null;

  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const domCheck = await cdp.evaluate(`(() => {
      const resultCard = document.querySelector('[data-testid="magnitude-final-result-card"]');
      const timeline = document.querySelector('[data-testid="magnitude-timeline"]');
      const text = resultCard ? resultCard.innerText : '';
      return {
        hasResultCard: !!resultCard,
        hasTimeline: !!timeline,
        textSnippet: text.slice(0, 300)
      };
    })()`);

    console.log(`[T+${i+1}s] DOM Check:`, domCheck.hasResultCard ? 'RESULT VISIBLE' : 'running...');

    if (domCheck.hasResultCard) {
      completed = true;
      resultData = domCheck;
      break;
    }
  }

  if (!completed) throw new Error('Magnitude run timed out in UI');

  console.log('\n--- DOM RESULT CARD VERIFICATION ---');
  console.log(JSON.stringify(resultData, null, 2));

  if (!resultData.textSnippet.includes('Example Domain')) {
    throw new Error('Rendered result text missing "Example Domain"');
  }

  // Test Second Target via Quick Action chip
  console.log('\n--- TESTING SECOND TARGET: wikipedia.org ---');
  await cdp.evaluate(`(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const wikiBtn = buttons.find(b => b.innerText.includes('wikipedia.org'));
    if (wikiBtn) wikiBtn.click();
  })()`);
  await new Promise(r => setTimeout(r, 500));

  await cdp.evaluate(`(() => {
    const btn = document.querySelector('[data-testid="magnitude-run-btn"]');
    if (btn) btn.click();
  })()`);

  completed = false;
  for (let i = 0; i < 25; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const wikiCheck = await cdp.evaluate(`(() => {
      const resultCard = document.querySelector('[data-testid="magnitude-final-result-card"]');
      const text = resultCard ? resultCard.innerText : '';
      return {
        hasResultCard: !!resultCard,
        containsWiki: text.toLowerCase().includes('wikipedia'),
        textSnippet: text.slice(0, 300)
      };
    })()`);

    if (wikiCheck.hasResultCard && wikiCheck.containsWiki) {
      completed = true;
      console.log(`[T+${i+1}s] Wikipedia result visible!`);
      break;
    }
  }

  if (!completed) throw new Error('Wikipedia run failed in UI');

  // Test Recent Runs Switching & Hydration
  console.log('\n--- TESTING RECENT RUNS HYDRATION ---');
  await cdp.evaluate(`(() => {
    const recent = document.querySelector('[data-testid="magnitude-recent-runs"]');
    const buttons = recent ? Array.from(recent.querySelectorAll('button')) : [];
    // Click the older run (example.com)
    if (buttons.length >= 2) buttons[1].click();
  })()`);
  await new Promise(r => setTimeout(r, 1500));

  const historicalCheck = await cdp.evaluate(`(() => {
    const resultCard = document.querySelector('[data-testid="magnitude-final-result-card"]');
    const text = resultCard ? resultCard.innerText : '';
    return {
      hasResultCard: !!resultCard,
      isExampleDomain: text.includes('Example Domain'),
      textSnippet: text.slice(0, 300)
    };
  })()`);

  console.log('Historical run switch result:', historicalCheck);
  if (!historicalCheck.isExampleDomain) {
    throw new Error('Historical run selection did not hydrate example.com');
  }

  console.log('\n=== ALL PACKAGED UI ACCEPTANCE TESTS PASSED! ===');
  cdp.ws.close();
}

main().catch(err => {
  console.error('Acceptance Test Failed:', err);
  process.exit(1);
});
