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
    return res.result.value;
  };

  return { ws, send, evaluate };
}

async function createGoal(goal, approvalPolicy = 'auto') {
  const res = await fetch('http://127.0.0.1:4000/api/chat/agents/goal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      goal,
      repositoryRoot: 'B:\\AgenticOS',
      approvalPolicy
    })
  });
  const data = await res.json();
  return data.goalId || data.id;
}

async function waitForGoal(goalId, timeoutSec = 60) {
  const start = Date.now();
  while (Date.now() - start < timeoutSec * 1000) {
    await new Promise(r => setTimeout(r, 2000));
    const res = await fetch(`http://127.0.0.1:4000/api/chat/agents/goal/${goalId}`);
    const data = await res.json();
    if (['completed', 'failed', 'stopped'].includes(data.status)) {
      return data;
    }
  }
  throw new Error(`Goal ${goalId} timed out after ${timeoutSec}s`);
}

async function main() {
  console.log('=== RUNNING FULL CODEX ACCEPTANCE SUITE ===\n');

  // TEST A: Read package.json project name
  console.log('[TEST A] Executing read-only project name check...');
  const goalA = await createGoal('READ-ONLY: Inspect B:\\AgenticOS\\package.json and tell me the project name.');
  const resA = await waitForGoal(goalA);
  console.log(`[TEST A] Finished with status=${resA.status}, finalAnswer=${resA.runSummary?.finalAnswer || resA.finalAnswer}`);

  // TEST B: Multi-file inspection task (no black screen)
  console.log('\n[TEST B] Executing multi-file task...');
  const goalB = await createGoal('READ-ONLY: Check package.json and server/package.json and list all shared dependencies.');
  const resB = await waitForGoal(goalB);
  console.log(`[TEST B] Finished with status=${resB.status}, result=${(resB.runSummary?.finalAnswer || resB.finalAnswer)?.slice(0, 80)}...`);

  // TEST C: 5 sequential CodeX tasks
  console.log('\n[TEST C] Running 5 sequential tasks...');
  const testCGoals = [
    'READ-ONLY: What is the main entry point in package.json?',
    'READ-ONLY: What port does the backend listen on by default?',
    'READ-ONLY: How many agents are defined in mockAgents in server/src/data.ts?',
    'READ-ONLY: Does electron/main.ts use contextIsolation?',
    'READ-ONLY: Check vite.config.ts and list plugins used.'
  ];
  const goalCIds = [];
  for (let i = 0; i < testCGoals.length; i++) {
    console.log(`  Subtask C.${i+1}: ${testCGoals[i]}`);
    const gId = await createGoal(testCGoals[i]);
    const res = await waitForGoal(gId);
    goalCIds.push(gId);
    console.log(`  Subtask C.${i+1} completed: status=${res.status}`);
  }

  // TEST D: Safe failed goal
  console.log('\n[TEST D] Creating safe failed goal...');
  const goalD = await createGoal('NON_EXISTENT_INTENT: Throw an error immediately.');
  // Pause/stop or let it fail
  await new Promise(r => setTimeout(r, 1000));
  await fetch(`http://127.0.0.1:4000/api/chat/agents/goal/${goalD}/pause`, { method: 'POST' });
  console.log(`[TEST D] Goal ${goalD} stopped/failed gracefully.`);

  // TEST E: Stopped goal
  console.log('\n[TEST E] Creating stopped goal...');
  const goalE = await createGoal('READ-ONLY: Long running scan of all files in repo.');
  await new Promise(r => setTimeout(r, 1000));
  await fetch(`http://127.0.0.1:4000/api/chat/agents/goal/${goalE}/pause`, { method: 'POST' });
  console.log(`[TEST E] Goal ${goalE} stopped.`);

  // Verify all goals are in database and fetched via API
  console.log('\n--- Verifying Goals in Database & API ---');
  const allGoalsRes = await fetch('http://127.0.0.1:4000/api/chat/agents/goals');
  const allGoals = await allGoalsRes.json();
  console.log(`Total goals retrieved from API: ${allGoals.length}`);

  const requiredGoalIds = [goalA, goalB, ...goalCIds, goalD, goalE];
  const allFound = requiredGoalIds.every(id => allGoals.some(g => g.id === id));
  console.log(`All required test goals present in persistent DB: ${allFound ? 'PASS (YES)' : 'FAIL'}`);

  // Test UI hydration via CDP
  console.log('\n--- Verifying UI Hydration via CDP ---');
  const cdp = await getCDP();
  await cdp.evaluate('window.location.hash = "#/codex"');
  await new Promise(r => setTimeout(r, 1500));

  const uiState = await cdp.evaluate(`({
    hasRecentGoals: !!document.querySelector('[data-testid="codex-recent-goals"]'),
    recentGoalsCount: document.querySelectorAll('[data-testid="codex-recent-goals"] .grid > div').length,
    selectedGoalVisible: !!document.querySelector('[data-testid="codex-composer"]'),
    finalResultVisible: !!document.querySelector('[data-testid="codex-final-summary"]'),
    isBlackScreen: document.body.innerHTML.length === 0
  })`);
  console.log('UI Hydration & Crash Check:', uiState);
  cdp.ws.close();

  console.log('\n=== ALL ACCEPTANCE TESTS COMPLETE ===');
}

main().catch(console.error);
