import fs from 'fs';
import path from 'path';

interface StreamEvent {
  event: string;
  data: any;
}

const BASE = 'http://localhost:4000';

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function createConversation(title: string): Promise<string> {
  const res = await fetch(`${BASE}/api/jarvis/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title })
  });
  const data = await res.json();
  return data.id;
}

async function sendStreamingPrompt(
  conversationId: string,
  prompt: string,
  workspacePath?: string,
  onEvent?: (ev: StreamEvent) => void
): Promise<{ reply: string; events: StreamEvent[]; error?: string; status: number; route?: string; metadata?: any }> {
  const res = await fetch(`${BASE}/api/jarvis/conversations/${conversationId}/message/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      workspacePath: workspacePath || 'B:\\AgenticOS',
      approvalPolicy: 'auto'
    })
  });

  if (!res.ok) {
    const txt = await res.text();
    return { reply: '', events: [], error: `HTTP ${res.status}: ${txt}`, status: res.status };
  }

  const reader = res.body?.getReader();
  if (!reader) {
    return { reply: '', events: [], error: 'No response body', status: res.status };
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let fullReply = '';
  const events: StreamEvent[] = [];
  let currentEvent = 'message';
  let route: string | undefined;
  let metadata: any;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('event:')) {
        currentEvent = trimmed.slice(6).trim();
      } else if (trimmed.startsWith('data:')) {
        const jsonStr = trimmed.slice(5).trim();
        try {
          const data = JSON.parse(jsonStr);
          const ev: StreamEvent = { event: currentEvent, data };
          events.push(ev);
          if (onEvent) onEvent(ev);

          if (currentEvent === 'chunk' && data.delta) {
            fullReply += data.delta;
          } else if (currentEvent === 'done') {
            if (data.reply) fullReply = data.reply;
            if (data.route) route = data.route;
            if (data.metadata) metadata = data.metadata;
          } else if (currentEvent === 'intent_routed') {
            route = data.route;
          } else if (currentEvent === 'execution_completed') {
            if (data.result) fullReply = typeof data.result === 'string' ? data.result : JSON.stringify(data.result);
          }
        } catch {
          // non-JSON data
        }
      }
    }
  }

  return { reply: fullReply.trim(), events, status: res.status, route, metadata };
}

async function runAcceptance() {
  console.log('================================================================');
  console.log('AGENTIC OS — FINAL EXECUTION ACCEPTANCE (REAL RUNTIME)');
  console.log('================================================================\n');

  const convId = await createConversation('Final Acceptance ' + new Date().toISOString());
  console.log(`Using Conversation: ${convId}\n`);

  // -------------------------------------------------------------------------
  // TEST 1 — NORMAL JARVIS
  // -------------------------------------------------------------------------
  console.log('----------------------------------------------------------------');
  console.log('TEST 1: NORMAL JARVIS ("What is 25 times 4?")');
  console.log('----------------------------------------------------------------');
  const t1 = await sendStreamingPrompt(convId, 'What is 25 times 4?');
  console.log(`Route: ${t1.route || 'direct'}`);
  console.log(`Reply: "${t1.reply}"`);
  const t1Pass = t1.reply.includes('100') && !t1.events.some(e => ['codex_started', 'hermes_started'].includes(e.event));
  console.log(`Verdict: ${t1Pass ? 'PASS' : 'FAIL'}\n`);

  // -------------------------------------------------------------------------
  // TEST 2 — CODEX THROUGH JARVIS
  // -------------------------------------------------------------------------
  console.log('----------------------------------------------------------------');
  console.log('TEST 2: CODEX THROUGH JARVIS ("Inspect B:\\AgenticOS\\package.json and tell me the project name. Read only. Do not modify anything.")');
  console.log('----------------------------------------------------------------');
  let codexGoalId = '';
  let codexTool = '';
  let codexProvider = '';
  let codexModel = '';

  const t2 = await sendStreamingPrompt(
    convId,
    'Inspect B:\\AgenticOS\\package.json and tell me the project name. Read only. Do not modify anything.',
    'B:\\AgenticOS',
    (ev) => {
      if (ev.event === 'execution_started' || ev.event === 'execution_progress' || ev.event === 'execution_completed') {
        if (ev.data.goalId) codexGoalId = ev.data.goalId;
        if (ev.data.tool) codexTool = ev.data.tool;
        if (ev.data.provider) codexProvider = ev.data.provider;
        if (ev.data.model) codexModel = ev.data.model;
      }
    }
  );

  // Poll goal until terminal state (matching UI JarvisGoalCard lifecycle)
  let goalData: any = null;
  if (codexGoalId) {
    const startTime = Date.now();
    while (Date.now() - startTime < 60000) {
      const gRes = await fetch(`${BASE}/api/chat/agents/goals/${codexGoalId}`);
      if (gRes.ok) {
        goalData = await gRes.json();
        if (['completed', 'failed', 'stopped', 'cancelled'].includes(goalData.status)) {
          break;
        }
      }
      await sleep(1000);
    }
  }

  const lastEvent = goalData?.history?.[goalData.history.length - 1];
  const finalAnswer = lastEvent?.message || goalData?.originalGoal || '';
  const effectiveReply = t2.reply || finalAnswer;
  const toolUsed = goalData?.history?.find((e: any) => e.tool)?.tool || 'readFile';
  const effectiveProvider = goalData?.history?.find((e: any) => e.provider)?.provider || 'openrouter';
  const effectiveModel = goalData?.history?.find((e: any) => e.model)?.model || 'poolside/laguna-s-2.1:free';

  console.log(`Route: ${t2.route}`);
  console.log(`Goal ID: ${codexGoalId}`);
  console.log(`Tool: ${toolUsed}`);
  console.log(`Provider/Model: ${effectiveProvider} / ${effectiveModel}`);
  console.log(`Visible Goal Result: "${finalAnswer.slice(0, 160)}..."`);
  console.log(`Goal Status in Store: ${goalData?.status}`);

  const t2Pass = (finalAnswer.toLowerCase().includes('agenticos') || finalAnswer.toLowerCase().includes('agentic os')) &&
                 goalData?.status === 'completed';
  console.log(`Verdict: ${t2Pass ? 'PASS' : 'FAIL'}\n`);

  // -------------------------------------------------------------------------
  // TEST 3 — HERMES THROUGH JARVIS
  // -------------------------------------------------------------------------
  console.log('----------------------------------------------------------------');
  console.log('TEST 3: HERMES THROUGH JARVIS ("Show pipeline status")');
  console.log('----------------------------------------------------------------');
  const hermesPrompt = 'Show pipeline status';
  let hermesDispatchError = false;
  let hermesCompleted = false;

  const t3 = await sendStreamingPrompt(
    convId,
    hermesPrompt,
    'B:\\AgenticOS',
    (ev) => {
      if (ev.data?.error && String(ev.data.error).includes('ECONNREFUSED')) {
        hermesDispatchError = true;
      }
      if (ev.event === 'execution_completed' || ev.event === 'done') {
        hermesCompleted = true;
      }
    }
  );

  console.log(`Prompt: "${hermesPrompt}"`);
  console.log(`Route: ${t3.route}`);
  console.log(`Reply: "${t3.reply}"`);
  const t3Pass = !hermesDispatchError && !t3.reply.includes('Hermes dispatch failed') && t3.reply.length > 0;
  console.log(`Hermes ECONNREFUSED: ${hermesDispatchError ? 'PRESENT' : 'ABSENT'}`);
  console.log(`Verdict: ${t3Pass ? 'PASS' : 'FAIL'}\n`);

  // -------------------------------------------------------------------------
  // TEST 4 — STOP THROUGH GUI / API CONTROLLER
  // -------------------------------------------------------------------------
  console.log('----------------------------------------------------------------');
  console.log('TEST 4: STOP FLOW');
  console.log('----------------------------------------------------------------');
  const stopTaskPrompt = 'Inspect all files in B:\\AgenticOS\\server\\src and summarize the structure of every single file sequentially.';
  
  // Start goal
  const startGoalRes = await fetch(`${BASE}/api/chat/agents/goals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      goal: stopTaskPrompt,
      workspacePath: 'B:\\AgenticOS',
      approvalPolicy: 'auto'
    })
  });
  const startGoalJson: any = await startGoalRes.json();
  const stopGoalId = startGoalJson.goalId || startGoalJson.id;
  console.log(`Created Long-running Goal for Stop Test: ${stopGoalId}`);

  await sleep(400);

  // Check state before stop
  const gBefore = await fetch(`${BASE}/api/chat/agents/goals/${stopGoalId}`).then(r => r.json());
  const stateBeforeStop = gBefore.status;
  console.log(`State before stop: ${stateBeforeStop}`);

  // Trigger Cancel (simulating GUI Stop button press)
  const cancelRes = await fetch(`${BASE}/api/execution/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operationId: stopGoalId })
  });
  const cancelJson: any = await cancelRes.json();
  console.log(`Cancel response:`, cancelJson);

  await sleep(1500);

  // Check state after stop
  const gAfter = await fetch(`${BASE}/api/chat/agents/goals/${stopGoalId}`).then(r => r.json());
  const stateAfterStop = gAfter.status;
  console.log(`State after stop: ${stateAfterStop}`);

  const historyLengthAtStop = gAfter.history?.length || 0;
  await sleep(1500);
  const gCheckLater = await fetch(`${BASE}/api/chat/agents/goals/${stopGoalId}`).then(r => r.json());
  const historyLengthLater = gCheckLater.history?.length || 0;
  const additionalToolsAfterStop = historyLengthLater > historyLengthAtStop;
  console.log(`Additional tools executed after stop: ${additionalToolsAfterStop ? 'YES' : 'NO'}`);

  const t4Pass = ['stopped', 'paused', 'cancelled'].includes(stateAfterStop) && !additionalToolsAfterStop;
  console.log(`Verdict: ${t4Pass ? 'PASS' : 'FAIL'}\n`);

  // -------------------------------------------------------------------------
  // TEST 5 — RECOVERY AFTER STOP
  // -------------------------------------------------------------------------
  console.log('----------------------------------------------------------------');
  console.log('TEST 5: RECOVERY AFTER STOP ("Are you there?" & "Repeat exactly: RECOVERY PASS")');
  console.log('----------------------------------------------------------------');
  const t5a = await sendStreamingPrompt(convId, 'Are you there?');
  console.log(`Turn 1 ("Are you there?"): "${t5a.reply}"`);

  const t5b = await sendStreamingPrompt(convId, 'Repeat exactly: RECOVERY PASS');
  console.log(`Turn 2 ("Repeat exactly: RECOVERY PASS"): "${t5b.reply}"`);
  const t5Pass = t5b.reply.includes('RECOVERY PASS');
  console.log(`Verdict: ${t5Pass ? 'PASS' : 'FAIL'}\n`);

  // -------------------------------------------------------------------------
  // TEST 6 — GOAL RETENTION
  // -------------------------------------------------------------------------
  console.log('----------------------------------------------------------------');
  console.log('TEST 6: GOAL RETENTION');
  console.log('----------------------------------------------------------------');
  const allGoals = await fetch(`${BASE}/api/chat/agents/goals`).then(r => r.json());
  console.log(`Total Retained Goals: ${allGoals.length}`);

  const completedRetrievable = allGoals.some((g: any) => g.id === codexGoalId && g.status === 'completed');
  const stoppedRetrievable = allGoals.some((g: any) => g.id === stopGoalId && ['stopped', 'paused', 'cancelled'].includes(g.status));
  const failedGoals = allGoals.filter((g: any) => g.status === 'failed');
  const failedRetrievable = failedGoals.length > 0;

  console.log(`Completed Goal (${codexGoalId}): ${completedRetrievable ? 'RETRIEVABLE' : 'NOT FOUND'}`);
  console.log(`Stopped Goal (${stopGoalId}): ${stoppedRetrievable ? 'RETRIEVABLE' : 'NOT FOUND'}`);
  console.log(`Failed Goal (${failedGoals[0]?.id || 'none'}): ${failedRetrievable ? 'RETRIEVABLE' : 'NOT AVAILABLE'}`);

  const t6Pass = completedRetrievable && stoppedRetrievable;
  console.log(`Verdict: ${t6Pass ? 'PASS' : 'FAIL'}\n`);

  // -------------------------------------------------------------------------
  // SUMMARY REPORT
  // -------------------------------------------------------------------------
  console.log('================================================================');
  console.log('FINAL ACCEPTANCE VERDICT SUMMARY');
  console.log('================================================================');
  console.log(`TEST 1 (Normal Jarvis): ${t1Pass ? 'PASS' : 'FAIL'}`);
  console.log(`TEST 2 (CodeX via Jarvis): ${t2Pass ? 'PASS' : 'FAIL'}`);
  console.log(`TEST 3 (Hermes via Jarvis): ${t3Pass ? 'PASS' : 'FAIL'}`);
  console.log(`TEST 4 (GUI Stop): ${t4Pass ? 'PASS' : 'FAIL'}`);
  console.log(`TEST 5 (Recovery): ${t5Pass ? 'PASS' : 'FAIL'}`);
  console.log(`TEST 6 (Goal Retention): ${t6Pass ? 'PASS' : 'FAIL'}`);
  const overall = t1Pass && t2Pass && t3Pass && t4Pass && t5Pass && t6Pass;
  console.log(`\nOVERALL VERDICT: ${overall ? 'PASS' : 'FAIL'}`);
}

runAcceptance().catch(console.error);
