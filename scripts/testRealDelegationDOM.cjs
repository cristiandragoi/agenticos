const WebSocket = require('ws');

async function testDelegation() {
  const res = await fetch('http://127.0.0.1:9222/json');
  const targets = await res.json();
  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);

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

  await new Promise(r => ws.on('open', r));
  console.log('[CDP] Connected to packaged Electron GUI!');

  // Navigate to Jarvis page
  await send('Page.navigate', { url: 'file:///C:/Users/Cris/Desktop/desktop/Agentic_OS/Agentic%20OS/resources/app/dist/index.html#/jarvis' });
  await new Promise(r => setTimeout(r, 2000));

  // 1. Create fresh conversation & send delegation message
  const prompt = 'Use CodeX to inspect B:\\AgenticOS\\package.json and server\\package.json and summarize the differences.';
  console.log('[Test] Sending prompt to Jarvis:', prompt);

  const convRes = await fetch('http://localhost:4000/api/jarvis/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Real GUI Delegation Acceptance' })
  });
  const conv = await convRes.json();
  console.log('[Test] Created conversation:', conv.id);

  // Send message
  const opId = 'op-gui-accept-' + Date.now();
  const sendRes = await fetch(`http://localhost:4000/api/jarvis/conversations/${conv.id}/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      operationId: opId,
      inputChannel: 'typed',
      workspacePath: 'B:\\AgenticOS'
    })
  });

  // Read SSE stream to get goalId
  const reader = sendRes.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let goalId = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (line.startsWith('data:')) {
        const d = line.slice(5).trim();
        if (!d) continue;
        try {
          const parsed = JSON.parse(d);
          if (parsed.goalId) goalId = parsed.goalId;
          if (parsed.event) console.log('  Stream Event:', parsed.event);
        } catch {}
      }
    }
  }

  // Also check conversation messages for goalId
  if (!goalId) {
    const mRes = await fetch(`http://localhost:4000/api/jarvis/conversations/${conv.id}/messages`);
    const msgs = await mRes.json();
    for (const m of msgs) {
      if (m.goalId) goalId = m.goalId;
    }
  }

  console.log('[Test] Delegated CodeX Goal ID:', goalId);

  // Wait for CodeX completion
  if (goalId) {
    const start = Date.now();
    while (Date.now() - start < 60000) {
      await new Promise(r => setTimeout(r, 2000));
      const gRes = await fetch(`http://localhost:4000/api/chat/agents/goal/${goalId}`);
      const g = await gRes.json();
      console.log('  Goal status:', g.status, 'events:', g.history?.length);
      if (['completed', 'failed', 'stopped'].includes(g.status)) break;
    }
  }

  // Load conversation in packaged GUI
  await send('Runtime.evaluate', {
    expression: `(() => {
      window.location.hash = '#/jarvis';
      sessionStorage.setItem('activeConversationId', '${conv.id}');
      // Trigger conversation selection if store available
    })()`
  });

  await new Promise(r => setTimeout(r, 2500));

  // Query DOM in real running Electron application
  const domCheck = await send('Runtime.evaluate', {
    expression: `(() => {
      const card = document.querySelector('[data-testid="jarvis-goal-card"]');
      const finalResult = document.querySelector('[data-testid="jarvis-goal-final-result"]');
      const copyBtn = document.querySelector('[aria-label="Copy Result"], [title="Copy Result"]');
      return {
        hasGoalCard: !!card,
        hasFinalResult: !!finalResult,
        hasCopyBtn: !!copyBtn,
        cardHeaderText: card ? card.querySelector('h3')?.innerText : null,
        finalResultSnippet: finalResult ? finalResult.innerText.slice(0, 400) : null
      };
    })()`,
    returnByValue: true
  });

  console.log('=== REAL PACKAGED DOM RESULT ===');
  console.log(JSON.stringify(domCheck.result.value, null, 2));

  ws.close();
}

testDelegation().catch(console.error);
