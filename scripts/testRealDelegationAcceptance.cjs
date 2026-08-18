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
  console.log('Launching Packaged App with remote debugging on 9222...');
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
  console.log('=== REAL PACKAGED ACCEPTANCE TEST: JARVIS -> MAGNITUDE DELEGATION ===\n');

  await terminateApp();
  await startPackagedApp();

  const cdp = await getCDP();

  // Navigate to Jarvis Studio
  await cdp.evaluate('window.location.hash = "#/jarvis"');
  await new Promise(r => setTimeout(r, 2000));

  // Get active conversations or create a new conversation
  const convsRes = await fetch('http://127.0.0.1:4000/api/jarvis/conversations');
  const convs = await convsRes.json();
  let conversationId = convs.conversations?.[0]?.id;
  if (!conversationId) {
    const createRes = await fetch('http://127.0.0.1:4000/api/jarvis/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Magnitude Routing Acceptance' })
    });
    const created = await createRes.json();
    conversationId = created.conversation?.id || created.id;
  }
  console.log(`Target Jarvis Conversation ID: ${conversationId}`);

  // Count goals before request to ensure CodeX is NOT invoked
  const goalsBeforeRes = await fetch('http://127.0.0.1:4000/api/chat/agents/goals');
  const goalsBefore = await goalsBeforeRes.json();
  const goalCountBefore = Array.isArray(goalsBefore) ? goalsBefore.length : 0;

  const prompt = "Jarvis, use Magnitude to open https://example.com, inspect the page, and bring the result back here. Do not use CodeX and do not create an automation.";
  console.log(`\nSending prompt to Jarvis SSE stream: "${prompt}"`);

  const streamRes = await fetch(`http://127.0.0.1:4000/api/jarvis/conversations/${conversationId}/message/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt })
  });

  const reader = streamRes.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const events = [];
  let currentEventName = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop(); // remainder
    for (const line of lines) {
      if (line.startsWith('event: ')) {
        currentEventName = line.slice(7).trim();
      } else if (line.startsWith('data: ')) {
        try {
          const parsed = JSON.parse(line.slice(6));
          events.push({ event: currentEventName, ...parsed });
          console.log(`[Stream Event] Event: ${currentEventName}`, parsed.route || parsed.message || parsed.chunk || parsed.type || '');
        } catch {}
      }
    }
  }

  // 1. Check Intent Classification Event
  console.log('\n--- ALL STREAM EVENTS ---');
  console.log(JSON.stringify(events, null, 2));

  const intentEvent = events.find(e => e.event === 'intent' || e.type === 'intent' || e.route);
  console.log('\n--- INTENT VERIFICATION ---');
  console.log('Intent Classified Event:', intentEvent);

  if (!intentEvent) {
    throw new Error('No intent event received from Jarvis stream');
  }

  const effectiveRoute = intentEvent.route;
  console.log(`Effective Routed Intent: ${effectiveRoute}`);

  if (effectiveRoute !== 'magnitude') {
    throw new Error(`FAIL: Expected route 'magnitude', but got '${effectiveRoute}'`);
  }
  console.log('[PASS] SYSTEM: Intent correctly routed to MAGNITUDE!');

  // 2. Check Execution Completed Event
  const completedEvent = events.find(e => e.event === 'execution_completed' || e.type === 'execution_completed');
  console.log('\n--- EXECUTION VERIFICATION ---');
  console.log('Completed Event:', completedEvent);

  if (!completedEvent || completedEvent.status !== 'completed') {
    throw new Error('Magnitude delegation did not finish with status completed');
  }

  // Fetch the persisted Magnitude run to verify extracted content
  const runRes = await fetch(`http://127.0.0.1:4000/api/magnitude/runs/${completedEvent.goalId}`);
  const runData = await runRes.json();
  console.log('Persisted Magnitude Run:', {
    id: runData.id,
    status: runData.status,
    title: runData.result?.title,
    url: runData.result?.url,
    contentSnippet: runData.result?.text?.slice(0, 100)
  });

  if (!runData.result?.title?.includes('Example Domain')) {
    throw new Error(`Persisted run does not contain expected "Example Domain" title: ${JSON.stringify(runData.result)}`);
  }
  console.log('[PASS] Magnitude completed browser run and extracted "Example Domain" content!');

  // 3. Verify CodeX was NOT invoked
  const goalsAfterRes = await fetch('http://127.0.0.1:4000/api/chat/agents/goals');
  const goalsAfter = await goalsAfterRes.json();
  const goalCountAfter = Array.isArray(goalsAfter) ? goalsAfter.length : 0;
  console.log(`CodeX Goal Count Before: ${goalCountBefore}, After: ${goalCountAfter}`);
  if (goalCountAfter > goalCountBefore) {
    throw new Error('FAIL: CodeX goal was unexpectedly created!');
  }
  console.log('[PASS] CodeX goal was NOT created (0 new goals).');

  // 4. Verify Jarvis UI DOM rendered the response
  await new Promise(r => setTimeout(r, 2000));
  const domCheck = await cdp.evaluate(`(() => {
    const text = document.body.innerText;
    return {
      hasExampleDomain: text.includes('Example Domain'),
      hasMagnitudeResult: text.includes('Magnitude Browser Inspection Result') || text.includes('Magnitude'),
      snippet: text.slice(0, 500)
    };
  })()`);
  console.log('\n--- JARVIS UI DOM CHECK ---');
  console.log('DOM Check:', domCheck);

  if (!domCheck.hasExampleDomain) {
    throw new Error('Jarvis UI DOM does not contain the delivered Example Domain result');
  }
  console.log('[PASS] Jarvis UI DOM cleanly rendered Magnitude inspection results!');

  console.log('\n=== REAL PACKAGED ACCEPTANCE PASSED 100%! ===');
  cdp.ws.close();
}

main().catch(err => {
  console.error('Acceptance Test Failed:', err);
  process.exit(1);
});
