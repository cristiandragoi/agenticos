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
  const targetPath = 'B:/AgenticOS/scratch/codex_proof.txt';
  if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);

  // Kill existing instances
  try {
    execSync('powershell -Command "Get-Process | Where-Object { $_.ProcessName -like \'*Agentic*\' } | Stop-Process -Force"');
  } catch {}
  await new Promise(r => setTimeout(r, 1000));

  await startPackagedApp();
  const cdp = await getCDP();

  await cdp.evaluate('window.location.hash = "#/codex"');
  await new Promise(r => setTimeout(r, 1000));

  const prompt = 'Create B:\\AgenticOS\\scratch\\codex_proof.txt with exact content CODEX IS REALLY WORKING then read it back and verify it.';

  await cdp.evaluate(`(() => {
    const textarea = document.querySelector('[data-testid="codex-composer"] textarea');
    if (textarea) {
      textarea.focus();
      textarea.click();
    }
  })()`);
  await new Promise(r => setTimeout(r, 300));

  for (const char of prompt) {
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', text: char, unmodifiedText: char });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp' });
  }
  await new Promise(r => setTimeout(r, 500));

  await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', windowsVirtualKeyCode: 13, unmodifiedText: '\r', text: '\r' });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', windowsVirtualKeyCode: 13 });

  await cdp.evaluate(`(() => {
    const buttons = Array.from(document.querySelectorAll('[data-testid="codex-composer"] button'));
    const sendBtn = buttons.find(b => b.innerText.includes('Send'));
    if (sendBtn && !sendBtn.disabled) sendBtn.click();
  })()`);

  console.log('Submitted goal via UI...');

  // Wait for completion
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 1500));
    const goalsRes = await fetch('http://127.0.0.1:4000/api/chat/agents/goals');
    const goals = await goalsRes.json();
    const latest = goals[0];
    if (!latest) continue;

    console.log(`Poll T+${(i+1)*1.5}s: Goal ${latest.id}, status=${latest.status}`);

    if (latest.status === 'completed') {
      console.log('[PASS] Completed!');
      console.log('Physical file exists:', fs.existsSync(targetPath));
      console.log('Physical file content:', fs.existsSync(targetPath) ? fs.readFileSync(targetPath, 'utf8') : null);
      cdp.ws.close();
      return;
    }
  }
}

main().catch(console.error);
