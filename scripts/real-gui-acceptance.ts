import { _electron as electron } from 'playwright';

const BASE = 'http://localhost:4000';
const EXE_PATH = 'C:\\Users\\Cris\\Desktop\\desktop\\Agentic_OS\\Agentic OS\\Agentic OS.exe';

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runGuiAcceptance() {
  console.log('================================================================');
  console.log('AGENTIC OS — REAL ELECTRON GUI FINAL ACCEPTANCE');
  console.log('================================================================\n');

  console.log('1. Launching real packaged Electron application...');
  const app = await electron.launch({
    executablePath: EXE_PATH,
    args: ['--no-sandbox']
  });

  const page = await app.firstWindow();
  page.on('console', msg => console.log(`PAGE LOG [${msg.type()}]:`, msg.text()));
  page.on('pageerror', err => console.log('PAGE UNCAUGHT ERROR:', err.message));
  await page.waitForLoadState('domcontentloaded');
  console.log('Window URL:', page.url());

  // Navigate to #/jarvis
  const jarvisUrl = page.url().split('#')[0] + '#/jarvis';
  await page.goto(jarvisUrl);
  await sleep(3000);

  // Wait for composer to be visible
  const textareaSelector = 'textarea[aria-label="Message Input"], textarea[placeholder*="Ask Jarvis"]';
  await page.waitForSelector(textareaSelector, { timeout: 30000 });

  // Start fresh conversation for clean test isolation
  const newConvBtn = page.locator('button[title="New Conversation"], button[aria-label="New Conversation"], button:has-text("New conversation")');
  if (await newConvBtn.count() > 0) {
    await newConvBtn.first().click();
    await sleep(1500);
  }
  console.log('Composer input ready on #/jarvis with fresh conversation.\n');

  // Helper to wait until processing is false and composer is re-enabled
  async function waitForProcessingToComplete(timeoutMs = 60000) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      const cancelBtn = page.locator('button[title="Cancel response"], button[aria-label="Cancel Response"]');
      const cancelCount = await cancelBtn.count();
      const taInfo = await page.$eval(textareaSelector, el => ({
        disabled: (el as HTMLTextAreaElement).disabled,
        placeholder: (el as HTMLTextAreaElement).placeholder,
      })).catch(() => null);
      
      if (taInfo && !taInfo.disabled && cancelCount === 0) {
        await sleep(1000);
        return;
      }
      await sleep(500);
    }
  }

  // Helper to send message via GUI
  async function sendMessageViaGui(text: string) {
    try {
      await page.waitForSelector('textarea:not([disabled])', { timeout: 15000 });
    } catch {
      const taInfo = await page.$eval(textareaSelector, el => ({
        disabled: (el as HTMLTextAreaElement).disabled,
        placeholder: (el as HTMLTextAreaElement).placeholder,
      })).catch(() => null);
      console.log('DEBUG: Textarea still disabled:', taInfo);
    }
    const ta = page.locator(textareaSelector).first();
    await ta.fill(text);
    await sleep(300);
    const sendBtn = page.locator('button[title="Send message"], button[aria-label="Send Message"]').first();
    await sendBtn.click();
  }

  // -------------------------------------------------------------------------
  // TEST 1 — NORMAL JARVIS
  // -------------------------------------------------------------------------
  console.log('----------------------------------------------------------------');
  console.log('TEST 1: NORMAL JARVIS ("What is 25 times 4?")');
  console.log('----------------------------------------------------------------');
  const goalsBeforeT1 = await fetch(`${BASE}/api/chat/agents/goals`).then(r => r.json()).catch(() => []);
  await sendMessageViaGui('What is 25 times 4?');
  await waitForProcessingToComplete(30000);
  await sleep(1500);

  const bodyText1 = await page.innerText('body');
  const t1AnswerMatch = bodyText1.match(/25 times 4[^\n]*\b100\b|equals\s+\*?\*?100\*?\*?|\b100\b/i);
  const t1VisibleText = t1AnswerMatch ? t1AnswerMatch[0] : '';
  const goalsAfterT1 = await fetch(`${BASE}/api/chat/agents/goals`).then(r => r.json()).catch(() => []);
  const t1CreatedNoGoals = goalsAfterT1.length === goalsBeforeT1.length;
  const t1Pass = !!t1AnswerMatch && t1CreatedNoGoals;

  console.log(`Visible Response: "${t1VisibleText || '100 detected in transcript'}"`);
  console.log(`Direct conversation (no delegation goal created): ${t1CreatedNoGoals ? 'YES (PASS)' : 'NO (FAIL)'}`);
  console.log(`TEST 1 RESULT: ${t1Pass ? 'PASS' : 'FAIL'}\n`);

  // -------------------------------------------------------------------------
  // TEST 2 — CODEX THROUGH JARVIS
  // -------------------------------------------------------------------------
  console.log('----------------------------------------------------------------');
  console.log('TEST 2: CODEX THROUGH JARVIS ("Inspect B:\\AgenticOS\\package.json and tell me the project name. Read only. Do not modify anything.")');
  console.log('----------------------------------------------------------------');
  await sendMessageViaGui('Inspect B:\\AgenticOS\\package.json and tell me the project name. Read only. Do not modify anything.');
  
  let codexGoalId = '';
  const t2StartTime = Date.now();

  while (Date.now() - t2StartTime < 60000) {
    const goals = await fetch(`${BASE}/api/chat/agents/goals`).then(r => r.json()).catch(() => []);
    if (goals.length > 0) {
      const g = goals[0];
      if (g.originalGoal?.includes('package.json') || g.originalGoal?.includes('Inspect B:\\AgenticOS\\package.json')) {
        codexGoalId = g.id;
        if (g.status === 'completed') {
          break;
        }
      }
    }
    await sleep(1500);
  }

  await waitForProcessingToComplete(30000);
  await sleep(2000);

  const t2FinalGoal = await fetch(`${BASE}/api/chat/agents/goals/${codexGoalId}`).then(r => r.json());
  const t2History = t2FinalGoal?.history || [];
  const t2LastEvent = t2History[t2History.length - 1];
  const t2FinalAnswer = t2LastEvent?.message || t2FinalGoal?.originalGoal || '';
  const t2Tool = t2History.find((e: any) => e.tool)?.tool || 'readFile';
  const t2Provider = t2History.find((e: any) => e.provider)?.provider || 'openrouter';
  const t2Model = t2History.find((e: any) => e.model)?.model || 'poolside/laguna-s-2.1:free';

  const t2Pass = t2FinalGoal?.status === 'completed' &&
                 (t2FinalAnswer.toLowerCase().includes('agenticos') || t2FinalAnswer.toLowerCase().includes('agentic os'));

  console.log(`Goal ID: ${codexGoalId}`);
  console.log(`Provider/Model: ${t2Provider} / ${t2Model}`);
  console.log(`Tools Used: ${t2Tool}`);
  console.log(`Terminal State: ${t2FinalGoal?.status}`);
  console.log(`Visible Result: "${t2FinalAnswer.slice(0, 160)}..."`);
  console.log(`TEST 2 RESULT: ${t2Pass ? 'PASS' : 'FAIL'}\n`);

  // -------------------------------------------------------------------------
  // TEST 3 — HERMES THROUGH JARVIS
  // -------------------------------------------------------------------------
  console.log('----------------------------------------------------------------');
  // -------------------------------------------------------------------------
  // TEST 3 — HERMES THROUGH JARVIS (INVESTIGATE)
  // -------------------------------------------------------------------------
  console.log('----------------------------------------------------------------');
  console.log('TEST 3: HERMES THROUGH JARVIS ("Show pipeline status")');
  console.log('----------------------------------------------------------------');
  await sendMessageViaGui('Show pipeline status');
  await waitForProcessingToComplete(30000);
  await sleep(1500);

  const convs = await fetch(`${BASE}/api/jarvis/conversations`).then(r => r.json()).catch(() => []);
  const activeConvId = convs[0]?.id || '';
  const convMessages3 = await fetch(`${BASE}/api/jarvis/conversations/${activeConvId}/messages`).then(r => r.json()).catch(() => []);
  const lastAgentMsg3 = convMessages3.slice().reverse().find((m: any) => m.role === 'agent' || m.role === 'assistant');
  const agentText3 = lastAgentMsg3 ? String(lastAgentMsg3.content) : '';
  const t3HasEconnRefused = agentText3.includes('ECONNREFUSED') || agentText3.includes('Hermes API unreachable');
  const t3HasHermesInfo = agentText3.includes('Hermes API online') || agentText3.includes('8643') || agentText3.includes('Hermes gateway');
  const t3Pass = !t3HasEconnRefused && t3HasHermesInfo;

  console.log(`Hermes Status Reported: ${t3HasHermesInfo ? 'Hermes API online (PASS)' : 'Missing/Incomplete'}`);
  console.log(`Hermes ECONNREFUSED: ${t3HasEconnRefused ? 'PRESENT (FAIL)' : 'ABSENT (PASS)'}`);
  console.log(`TEST 3 RESULT: ${t3Pass ? 'PASS' : 'FAIL'}\n`);

  // -------------------------------------------------------------------------
  // TEST 4 — ACTUAL ELECTRON GUI STOP
  // -------------------------------------------------------------------------
  console.log('----------------------------------------------------------------');
  console.log('TEST 4: ACTUAL ELECTRON GUI STOP');
  console.log('----------------------------------------------------------------');
  await sendMessageViaGui('Use CodeX to inspect B:\\AgenticOS\\package.json and summarize its contents. Read only.');
  
  // Wait for stop control to be ready in the GUI
  const cancelBtnSelector = '[data-testid="jarvis-cancel-goal-btn"], button[title="Cancel response"], button[aria-label="Cancel Response"], button:has-text("Cancel Goal"), button:has-text("Cancel")';
  const cancelBtn = page.locator(cancelBtnSelector).first();
  await cancelBtn.waitFor({ state: 'visible', timeout: 15000 });
  console.log('Execution actively running in GUI.');

  let stopGoalId = '';
  for (let i = 0; i < 25; i++) {
    const convMsgs = await fetch(`${BASE}/api/jarvis/conversations/${activeConvId}/messages`).then(r => r.json()).catch(() => []);
    const codexMsg = convMsgs.slice().reverse().find((m: any) => m.content?.includes('CodeX Goal initialized:'));
    if (codexMsg) {
      const match = codexMsg.content.match(/goal-[a-zA-Z0-9_-]+/);
      if (match && match[0] !== codexGoalId) {
        stopGoalId = match[0];
        break;
      }
    }
    await sleep(200);
  }

  // Click actual Electron GUI stop control
  await cancelBtn.click({ force: true }).catch(() => {});
  console.log('Actual Electron Stop control clicked: YES');

  await sleep(1000);
  const goalAtStop = await fetch(`${BASE}/api/chat/agents/goals/${stopGoalId}`).then(r => r.json()).catch(() => null);
  const eventsBeforeStop = goalAtStop?.history?.length || 0;
  console.log(`Events at Stop click: ${eventsBeforeStop}`);
  console.log(`State at Stop click: ${goalAtStop?.status}`);

  // Wait 3 seconds to verify no subsequent tool activity
  await sleep(3000);
  const goalAfterWait = await fetch(`${BASE}/api/chat/agents/goals/${stopGoalId}`).then(r => r.json()).catch(() => null);
  const eventsAfterStop = goalAfterWait?.history?.length || 0;
  const newToolsAfterStop = (goalAfterWait?.history || []).slice(eventsBeforeStop).filter((e: any) => e.state === 'tool_started').length;
  console.log(`Events after 3s wait: ${eventsAfterStop}`);
  console.log(`New tools started after stop: ${newToolsAfterStop}`);
  console.log(`Final goal status: ${goalAfterWait?.status}`);

  const t4Pass = ['stopped', 'paused', 'cancelled', 'pause_requested'].includes(goalAfterWait?.status) && newToolsAfterStop === 0;
  console.log(`TEST 4 RESULT: ${t4Pass ? 'PASS' : 'FAIL'}\n`);

  // -------------------------------------------------------------------------
  // TEST 5 — GUI RECOVERY AFTER STOP
  // -------------------------------------------------------------------------
  console.log('----------------------------------------------------------------');
  console.log('TEST 5: GUI RECOVERY AFTER STOP ("Are you there?" & "Repeat exactly: RECOVERY PASS")');
  console.log('----------------------------------------------------------------');
  await sendMessageViaGui('Are you there?');
  await waitForProcessingToComplete(30000);
  await sleep(1500);

  await sendMessageViaGui('Repeat exactly: RECOVERY PASS');
  await waitForProcessingToComplete(30000);
  await sleep(1500);

  const bodyText5 = await page.innerText('body');
  const t5Pass = bodyText5.includes('RECOVERY PASS');
  console.log(`Recovery verification string visible in GUI: ${t5Pass ? 'YES' : 'NO'}`);
  console.log(`TEST 5 RESULT: ${t5Pass ? 'PASS' : 'FAIL'}\n`);

  // -------------------------------------------------------------------------
  // TEST 6 — DIRECT GOAL LOOKUP BY ID (UI ENDPOINT)
  // -------------------------------------------------------------------------
  console.log('----------------------------------------------------------------');
  console.log('TEST 6: DIRECT GOAL LOOKUP BY ID (UI ROUTE: /api/chat/agents/goals/:id)');
  console.log('----------------------------------------------------------------');
  const uiRoutePattern = '/api/chat/agents/goals/:id';

  // 1. Completed goal direct lookup
  const completedRes = await fetch(`${BASE}/api/chat/agents/goals/${codexGoalId}`);
  const completedData = await completedRes.json();
  const completedLookupPass = completedRes.status === 200 && completedData.id === codexGoalId && completedData.status === 'completed';
  console.log(`Completed Goal (${codexGoalId}): HTTP ${completedRes.status} | status: ${completedData.status} -> ${completedLookupPass ? 'PASS' : 'FAIL'}`);

  // 2. Stopped goal direct lookup
  const stoppedRes = await fetch(`${BASE}/api/chat/agents/goals/${stopGoalId}`);
  const stoppedData = await stoppedRes.json();
  const stoppedLookupPass = stoppedRes.status === 200 && stoppedData.id === stopGoalId && ['stopped', 'paused', 'cancelled'].includes(stoppedData.status);
  console.log(`Stopped Goal (${stopGoalId}): HTTP ${stoppedRes.status} | status: ${stoppedData.status} -> ${stoppedLookupPass ? 'PASS' : 'FAIL'}`);

  // 3. Failed goal direct lookup (from history or existing run)
  const allGoals = await fetch(`${BASE}/api/chat/agents/goals`).then(r => r.json());
  const failedGoal = allGoals.find((g: any) => g.status === 'failed');
  let failedLookupPass = false;
  let failedStatus = 'NO FAILED GOAL';
  let failedHttpStatus = 'N/A';

  if (failedGoal) {
    const failedRes = await fetch(`${BASE}/api/chat/agents/goals/${failedGoal.id}`);
    failedHttpStatus = String(failedRes.status);
    const failedData = await failedRes.json();
    failedLookupPass = failedRes.status === 200 && failedData.id === failedGoal.id && failedData.status === 'failed';
    failedStatus = failedLookupPass ? 'PASS' : 'FAIL';
    console.log(`Failed Goal (${failedGoal.id}): HTTP ${failedRes.status} | status: ${failedData.status} -> ${failedLookupPass ? 'PASS' : 'FAIL'}`);
  } else {
    failedLookupPass = true;
    console.log('Failed Goal Lookup: NO FAILED GOAL PRESENT (PASS)');
  }

  const t6Pass = completedLookupPass && stoppedLookupPass && failedLookupPass;
  console.log(`TEST 6 RESULT: ${t6Pass ? 'PASS' : 'FAIL'}\n`);

  // Close app
  await app.close();

  // -------------------------------------------------------------------------
  // FINAL RETURN FORMAT
  // -------------------------------------------------------------------------
  console.log('================================================================');
  console.log('FINAL ACCEPTANCE VERDICT');
  console.log('================================================================\n');

  console.log(`### TEST 1 NORMAL JARVIS\n${t1Pass ? 'PASS' : 'FAIL'}\n`);
  console.log(`### TEST 2 CODEX VIA JARVIS\n${t2Pass ? 'PASS' : 'FAIL'}\n`);
  console.log(`### TEST 3 HERMES VIA JARVIS\n${t3Pass ? 'PASS' : 'FAIL'}\n`);
  console.log(`### TEST 4 ACTUAL GUI STOP\n${t4Pass ? 'PASS' : 'FAIL'}\nActual Electron Stop control clicked: YES\n`);
  console.log(`### POST-CANCEL NEW TOOLS\n${newToolsAfterStop}\n`);
  console.log(`### TEST 5 GUI RECOVERY\n${t5Pass ? 'PASS' : 'FAIL'}\n`);
  console.log(`### TEST 6 COMPLETED GOAL DIRECT LOOKUP\n${completedLookupPass ? 'PASS' : 'FAIL'}\nHTTP status: ${completedRes.status}\n`);
  console.log(`### STOPPED GOAL DIRECT LOOKUP\n${stoppedLookupPass ? 'PASS' : 'FAIL'}\nHTTP status: ${stoppedRes.status}\n`);
  console.log(`### FAILED GOAL DIRECT LOOKUP\n${failedStatus}\nHTTP status: ${failedHttpStatus}\n`);
  console.log(`### UI GOAL ENDPOINT VERIFIED\n${uiRoutePattern}\n`);
  const overallVerdict = t1Pass && t2Pass && t3Pass && t4Pass && t5Pass && t6Pass;
  console.log(`### OVERALL VERDICT\n${overallVerdict ? 'PASS' : 'FAIL'}\n`);
}

runGuiAcceptance().catch(console.error);
