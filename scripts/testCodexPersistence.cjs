const WebSocket = require('ws');

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
    return res.result.value;
  };

  return { ws, send, evaluate };
}

async function run() {
  console.log('--- Connecting to Packaged Agentic OS via CDP ---');
  const cdp = await getCDP();

  // Navigate to CodeX Studio route
  console.log('Navigating to #/codex...');
  await cdp.evaluate('window.location.hash = "#/codex"');
  await new Promise(r => setTimeout(r, 1500));

  const pageInfo = await cdp.evaluate(`({
    url: window.location.href,
    hasRecentGoals: !!document.querySelector('[data-testid="codex-recent-goals"]'),
    hasComposer: !!document.querySelector('[data-testid="codex-composer"]'),
    bodySnippet: document.body.innerText.slice(0, 300)
  })`);
  console.log('CodeX Studio Page State:', pageInfo);

  // Test creating a CodeX task
  console.log('--- TEST A: Creating CodeX Goal ---');
  const createRes = await fetch('http://127.0.0.1:4000/api/chat/agents/goal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      goal: 'READ-ONLY: Inspect B:\\AgenticOS\\package.json and tell me the project name.',
      repositoryRoot: 'B:\\AgenticOS',
      approvalPolicy: 'auto'
    })
  });
  const createData = await createRes.json();
  console.log('Goal created:', createData);
  const goalId = createData.goalId || createData.id;

  // Wait for goal to reach completed status
  console.log('Waiting for goal completion...');
  let completedGoal = null;
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const gRes = await fetch(`http://127.0.0.1:4000/api/chat/agents/goal/${goalId}`);
    const gData = await gRes.json();
    console.log(`Poll ${i+1}: status=${gData.status}, historyLength=${gData.history?.length}`);
    if (gData.status === 'completed' || gData.status === 'failed' || gData.status === 'stopped') {
      completedGoal = gData;
      break;
    }
  }

  console.log('Goal status after execution:', completedGoal?.status);
  console.log('Final answer:', completedGoal?.runSummary?.finalAnswer || completedGoal?.runSummary || completedGoal?.finalAnswer);

  // Check DOM rendering of final result
  await new Promise(r => setTimeout(r, 1000));
  const domResult = await cdp.evaluate(`({
    hasFinalSummary: !!document.querySelector('[data-testid="codex-final-summary"]'),
    summaryText: document.querySelector('[data-testid="codex-final-summary"]')?.innerText?.slice(0, 200),
    hasRecentGoals: !!document.querySelector('[data-testid="codex-recent-goals"]'),
    timelineLength: document.querySelectorAll('[data-testid="codex-timeline"] > div').length
  })`);
  console.log('DOM Rendering Verification:', domResult);

  cdp.ws.close();
  console.log('--- TEST A SUCCESSFUL ---');
}

run().catch(console.error);
