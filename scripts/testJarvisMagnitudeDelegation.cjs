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
  console.log('=== JARVIS -> MAGNITUDE DELEGATION ACCEPTANCE TEST ===\n');

  try {
    execSync('powershell -Command "Get-Process | Where-Object { $_.ProcessName -like \'*Agentic*\' } | Stop-Process -Force"');
  } catch {}
  await new Promise(r => setTimeout(r, 1000));

  await startPackagedApp();

  // Test 1: POST /api/jarvis/conversations/:id/message
  console.log('--- TEST 1: Backend Orchestration API Test ---');
  const createConvRes = await fetch('http://127.0.0.1:4000/api/jarvis/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Magnitude Delegation Test' })
  });
  const conv = await createConvRes.json();
  console.log(`Created conversation: ${conv.id}`);

  const prompt = 'Open https://example.com and tell me what is on the page.';
  console.log(`Sending message to Jarvis: "${prompt}"`);

  const msgRes = await fetch(`http://127.0.0.1:4000/api/jarvis/conversations/${conv.id}/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt })
  });
  const orchestratorResult = await msgRes.json();
  console.log('Orchestrator Result:', orchestratorResult);

  if (orchestratorResult.route !== 'magnitude') {
    throw new Error(`Expected route 'magnitude', got '${orchestratorResult.route}'`);
  }
  if (orchestratorResult.status !== 'completed') {
    throw new Error(`Expected status 'completed', got '${orchestratorResult.status}'`);
  }

  // Fetch all messages in the conversation
  const msgsRes = await fetch(`http://127.0.0.1:4000/api/jarvis/conversations/${conv.id}/messages`);
  const messages = await msgsRes.json();
  console.log(`Retrieved ${messages.length} messages in conversation.`);

  const assistantMessage = messages.find(m => m.role === 'agent' || m.role === 'assistant');
  console.log('\n--- JARVIS ASSISTANT RESPONSE ---');
  console.log(assistantMessage ? assistantMessage.content : 'NO ASSISTANT MESSAGE');

  if (!assistantMessage || !assistantMessage.content.includes('Example Domain')) {
    throw new Error('Jarvis assistant message did not deliver Example Domain result!');
  }
  console.log('[PASS] API-level Jarvis -> Magnitude delegation and result delivery: PASS\n');

  // Test 2: SSE Stream endpoint
  console.log('--- TEST 2: SSE Stream Endpoint Test ---');
  const createConv2Res = await fetch('http://127.0.0.1:4000/api/jarvis/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Magnitude Stream Test' })
  });
  const conv2 = await createConv2Res.json();
  console.log(`Created stream conversation: ${conv2.id}`);

  const streamPrompt = 'Please inspect https://www.wikipedia.org/ and return what is on the page.';
  const streamRes = await fetch(`http://127.0.0.1:4000/api/jarvis/conversations/${conv2.id}/message/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: streamPrompt })
  });

  const streamText = await streamRes.text();
  console.log('Stream response bytes:', streamText.length);
  if (!streamText.includes('event: execution_completed') && !streamText.includes('event: done')) {
    throw new Error('Stream response did not complete successfully');
  }

  const msgs2Res = await fetch(`http://127.0.0.1:4000/api/jarvis/conversations/${conv2.id}/messages`);
  const msgs2 = await msgs2Res.json();
  const wikiMsg = msgs2.find(m => m.role === 'agent' || m.role === 'assistant');
  console.log('Stream conversation assistant message:', wikiMsg?.content?.slice(0, 200));

  if (!wikiMsg || !wikiMsg.content.toLowerCase().includes('wikipedia')) {
    throw new Error('Stream conversation did not deliver Wikipedia result');
  }
  console.log('[PASS] SSE stream delegation and result delivery: PASS\n');

  // Test 3: Packaged App UI Test via CDP
  console.log('--- TEST 3: Packaged Desktop App UI Verification ---');
  const cdp = await getCDP();

  // Navigate to Jarvis Studio
  await cdp.evaluate('window.location.hash = "#/jarvis"');
  await new Promise(r => setTimeout(r, 2000));

  // Type in Jarvis composer and send
  console.log('Submitting browser request in Jarvis UI...');
  const prompt3 = 'Open https://example.com and tell me what is on the page.';
  
  await cdp.evaluate(`(() => {
    const textarea = document.querySelector('textarea');
    if (textarea) {
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
      if (nativeSetter) {
        nativeSetter.call(textarea, ${JSON.stringify(prompt3)});
      } else {
        textarea.value = ${JSON.stringify(prompt3)};
      }
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }
  })()`);
  await new Promise(r => setTimeout(r, 500));

  // Submit via Enter key or Send button
  await cdp.evaluate(`(() => {
    const textarea = document.querySelector('textarea');
    if (textarea) {
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    }
    const sendBtn = document.querySelector('button[aria-label="Send message"]') ||
                    document.querySelector('button[title="Send"]') ||
                    document.querySelector('form button[type="submit"]');
    if (sendBtn) sendBtn.click();
  })()`);

  console.log('Waiting for Jarvis -> Magnitude response in UI...');
  let uiSuccess = false;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const textContent = await cdp.evaluate('document.body.innerText');
    if (textContent.includes('Example Domain') && textContent.includes('Magnitude')) {
      console.log(`[T+${i+1}s] Jarvis UI rendered Magnitude Example Domain result!`);
      uiSuccess = true;
      break;
    }
  }

  if (!uiSuccess) {
    const pageText = await cdp.evaluate('document.body.innerText.slice(0, 500)');
    console.log('Current Page Text:', pageText);
    throw new Error('Jarvis UI did not render Magnitude result within timeout');
  }

  console.log('\n=== ALL PHASE 4 DELEGATION TESTS PASSED! ===');
  cdp.ws.close();
}

main().catch(err => {
  console.error('Test Failed:', err);
  process.exit(1);
});
