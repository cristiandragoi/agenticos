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

(async () => {
  try {
    execSync('powershell -Command "Get-Process | Where-Object { $_.ProcessName -like \'*Agentic*\' } | Stop-Process -Force"');
  } catch {}
  await new Promise(r => setTimeout(r, 1000));

  execSync('powershell -Command "$env:AGENTICOS_ELECTRON_REMOTE_DEBUGGING_PORT=\'9222\'; Start-Process \'C:\\Users\\Cris\\Desktop\\desktop\\Agentic_OS\\Agentic OS\\Agentic OS.exe\'"');
  await new Promise(r => setTimeout(r, 4000));

  const cdp = await getCDP();
  await cdp.evaluate('window.location.hash = "#/codex"');
  await new Promise(r => setTimeout(r, 1500));

  const pageInfo = await cdp.evaluate(`(() => {
    return {
      hash: window.location.hash,
      textarea: !!document.querySelector('[data-testid="codex-composer"] textarea'),
      textareaDisabled: document.querySelector('[data-testid="codex-composer"] textarea')?.disabled,
      buttons: Array.from(document.querySelectorAll('[data-testid="codex-composer"] button')).map(b => ({ text: b.innerText, disabled: b.disabled })),
      activeGoal: window.localStorage.getItem('agenticos:codex-active-goal-id'),
      recentGoalsCount: document.querySelectorAll('[data-testid="codex-recent-goals"] button').length
    };
  })()`);

  console.log('Page info:', JSON.stringify(pageInfo, null, 2));

  // Let's test typing into textarea and calling handleSend
  const prompt = 'READ-ONLY: Inspect B:\\\\AgenticOS\\\\package.json and tell me the project name.';
  const sendResult = await cdp.evaluate(`(() => {
    const textarea = document.querySelector('[data-testid="codex-composer"] textarea');
    if (!textarea) return { error: 'No textarea' };
    
    // Set value using React internal setter
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    nativeSetter.call(textarea, ${JSON.stringify(prompt)});
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new Event('change', { bubbles: true }));

    const buttons = Array.from(document.querySelectorAll('[data-testid="codex-composer"] button'));
    const sendBtn = buttons.find(b => b.innerText.includes('Send'));
    if (!sendBtn) return { error: 'No send button' };
    if (sendBtn.disabled) return { error: 'Send button is disabled' };
    
    sendBtn.click();
    return { clicked: true };
  })()`);

  console.log('Send result:', sendResult);

  await new Promise(r => setTimeout(r, 2000));
  const res = await fetch('http://127.0.0.1:4000/api/chat/agents/goals');
  const goals = await res.json();
  console.log('Goals in DB after click:', goals.map(g => ({ id: g.id, goal: g.originalGoal?.slice(0, 50), status: g.status })));

  cdp.ws.close();
})();
