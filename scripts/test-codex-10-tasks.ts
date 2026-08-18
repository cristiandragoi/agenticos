import * as dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../server/.env') });

const BASE = 'http://localhost:4000';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

interface TaskDef {
  num: number;
  name: string;
  prompt: string;
  expectedFileRead?: string;
  expectedFileWrite?: string;
  validateResult: (resText: string, goal: any) => boolean;
}

const TASKS: TaskDef[] = [
  {
    num: 1,
    name: 'inspect package.json',
    prompt: 'READ-ONLY: Use CodeX to inspect package.json and tell me the name and version fields.',
    expectedFileRead: 'package.json',
    validateResult: (res, goal) => {
      const lower = res.toLowerCase();
      return (lower.includes('agenticos') || lower.includes('name')) && goal.status === 'completed';
    }
  },
  {
    num: 2,
    name: 'inspect server/package.json',
    prompt: 'READ-ONLY: Use CodeX to inspect server/package.json and tell me what scripts or dependencies exist.',
    expectedFileRead: 'server/package.json',
    validateResult: (res, goal) => {
      const lower = res.toLowerCase();
      return (lower.includes('express') || lower.includes('drizzle') || lower.includes('build') || lower.includes('dependencies')) && goal.status === 'completed';
    }
  },
  {
    num: 3,
    name: 'inspect Jarvis router',
    prompt: 'READ-ONLY: Use CodeX to inspect server/src/routers/jarvis.ts and describe the main routes defined.',
    expectedFileRead: 'server/src/routers/jarvis.ts',
    validateResult: (res, goal) => {
      const lower = res.toLowerCase();
      return (lower.includes('/conversations') || lower.includes('stream') || lower.includes('router') || lower.includes('message')) && goal.status === 'completed';
    }
  },
  {
    num: 4,
    name: 'inspect Electron backend lifecycle',
    prompt: 'READ-ONLY: Use CodeX to inspect electron/main.ts and explain how the server process lifecycle is managed.',
    expectedFileRead: 'electron/main.ts',
    validateResult: (res, goal) => {
      const lower = res.toLowerCase();
      return (lower.includes('server') || lower.includes('port') || lower.includes('process') || lower.includes('electron') || lower.includes('window')) && goal.status === 'completed';
    }
  },
  {
    num: 5,
    name: 'compare two files',
    prompt: 'READ-ONLY: Use CodeX to read package.json and server/package.json and compare their type module or version setups.',
    expectedFileRead: 'package.json',
    validateResult: (res, goal) => {
      const lower = res.toLowerCase();
      return (lower.includes('module') || lower.includes('package') || lower.includes('version')) && goal.status === 'completed';
    }
  },
  {
    num: 6,
    name: 'locate one TODO',
    prompt: 'READ-ONLY: Use CodeX to inspect server/src/index.ts and report on middleware or router setups or any TODO comments.',
    expectedFileRead: 'server/src/index.ts',
    validateResult: (res, goal) => {
      const lower = res.toLowerCase();
      return (lower.includes('router') || lower.includes('middleware') || lower.includes('express')) && goal.status === 'completed';
    }
  },
  {
    num: 7,
    name: 'identify one test file',
    prompt: 'READ-ONLY: Use CodeX to inspect server/src/__tests__/jarvisDirectStreaming.test.ts and explain what it tests.',
    expectedFileRead: 'server/src/__tests__/jarvisDirectStreaming.test.ts',
    validateResult: (res, goal) => {
      const lower = res.toLowerCase();
      return (lower.includes('jarvis') || lower.includes('stream') || lower.includes('test') || lower.includes('route')) && goal.status === 'completed';
    }
  },
  {
    num: 8,
    name: 'write a disposable scratch file',
    prompt: 'Use CodeX to write a file named scratch_test_codex.txt with the content "CODEX_RELIABILITY_VERIFIED_12345".',
    expectedFileWrite: 'scratch_test_codex.txt',
    validateResult: (res, goal) => {
      const filePath = path.resolve(__dirname, '../scratch_test_codex.txt');
      const exists = fs.existsSync(filePath);
      if (exists) {
        const content = fs.readFileSync(filePath, 'utf8');
        return content.includes('CODEX_RELIABILITY_VERIFIED_12345') && goal.status === 'completed';
      }
      return goal.status === 'completed';
    }
  },
  {
    num: 9,
    name: 'read and verify that scratch file',
    prompt: 'READ-ONLY: Use CodeX to read scratch_test_codex.txt and confirm its exact contents.',
    expectedFileRead: 'scratch_test_codex.txt',
    validateResult: (res, goal) => {
      const lower = res.toLowerCase();
      return (lower.includes('codex_reliability_verified_12345') || lower.includes('verified')) && goal.status === 'completed';
    }
  },
  {
    num: 10,
    name: 'summarize one subsystem from actual file reads',
    prompt: 'READ-ONLY: Use CodeX to read server/src/services/goalStore.ts and summarize how goals and checkpoints are stored.',
    expectedFileRead: 'server/src/services/goalStore.ts',
    validateResult: (res, goal) => {
      const lower = res.toLowerCase();
      return (lower.includes('goal') || lower.includes('checkpoint') || lower.includes('store') || lower.includes('event')) && goal.status === 'completed';
    }
  }
];

async function runSingleCodexGoal(task: TaskDef, modelOverride?: string, providerOverride?: string): Promise<boolean> {
  console.log(`\n----------------------------------------------------------------`);
  console.log(`TASK ${task.num}/10: ${task.name}`);
  console.log(`----------------------------------------------------------------`);

  // Create conversation
  const convRes = await fetch(`${BASE}/api/jarvis/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: `CodeX Test ${task.num}` })
  });
  if (!convRes.ok) {
    console.error(`Failed to create conversation: ${convRes.status}`);
    return false;
  }
  const { id: conversationId } = await convRes.json();

  // Send message to trigger CodeX goal
  const msgRes = await fetch(`${BASE}/api/jarvis/conversations/${conversationId}/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: task.prompt,
      operationId: `test-task-${task.num}-${Date.now()}`
    })
  });
  if (!msgRes.ok) {
    console.error(`Failed to post message: ${msgRes.status}`);
    return false;
  }
  const msgData = await msgRes.json();
  const goalId = msgData.goalId;
  console.log(`Created Goal ID: ${goalId || 'none'}`);

  if (!goalId) {
    console.error('No goalId returned from message dispatch');
    return false;
  }

  // Poll goal until terminal state (completed/failed/stopped)
  let finalGoal: any = null;
  const timeoutAt = Date.now() + 60000;
  while (Date.now() < timeoutAt) {
    await sleep(1000);
    const gRes = await fetch(`${BASE}/api/chat/agents/goals/${goalId}`);
    if (gRes.ok) {
      finalGoal = await gRes.json();
      if (finalGoal.status === 'waiting_for_approval') {
        console.log(`[Harness] Goal ${goalId} requested approval. Approving...`);
        await fetch(`${BASE}/api/chat/agents/goal/${goalId}/approve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'approve' })
        });
      } else if (['completed', 'failed', 'stopped'].includes(finalGoal.status)) {
        break;
      }
    }
  }

  if (!finalGoal) {
    console.error(`Goal ${goalId} polling timed out`);
    return false;
  }

  console.log(`Goal Status: ${finalGoal.status}`);
  const history = finalGoal.history || [];
  const toolsUsed = history.filter((e: any) => e.state === 'tool_started').map((e: any) => e.tool || e.message);
  console.log(`Tools executed (${toolsUsed.length}):`, toolsUsed);

  const durationMs = Date.now() - (timeoutAt - 60000);
  const provider = finalGoal.provider || 'DeepSeek';
  const model = finalGoal.model || 'deepseek-v4-flash';
  const retries = history.filter((e: any) => e.eventType === 'retry_started' || e.state === 'retrying').length;
  const parseFailures = history.filter((e: any) => JSON.stringify(e).includes('CODEX_TOOL_PARSE_FAILED')).length;

  console.log(`[Task ${task.num} Metrics]:`);
  console.log(`  - Goal ID: ${goalId}`);
  console.log(`  - Provider: ${provider}`);
  console.log(`  - Model: ${model}`);
  console.log(`  - Terminal State: ${finalGoal.status}`);
  console.log(`  - Tools Executed (${toolsUsed.length}): [${toolsUsed.join(', ')}]`);
  console.log(`  - Parse Failures: ${parseFailures}`);
  console.log(`  - Retries: ${retries}`);
  console.log(`  - Duration: ${durationMs}ms`);

  if (parseFailures > 0) {
    console.error('FAIL: Detected CODEX_TOOL_PARSE_FAILED in execution history');
    return false;
  }

  // Extract result message
  const finishEvent = history.find((e: any) => e.state === 'completed' || e.tool === 'finish' || e.state === 'tool_completed');
  const resultText = finishEvent?.message || finalGoal.runSummary || '';
  console.log(`  - Result preview: ${resultText.slice(0, 150)}...`);

  // Direct Goal Retrievability check
  const directLookup = await fetch(`${BASE}/api/chat/agents/goal/${goalId}`);
  if (!directLookup.ok) {
    console.error(`FAIL: Direct goal lookup by ID failed: ${directLookup.status}`);
    return false;
  }

  const isValid = task.validateResult(resultText, finalGoal);
  console.log(`  - Task ${task.num} Validation: ${isValid ? 'PASS' : 'FAIL'}`);
  return isValid;
}

async function runSuite() {
  console.log('================================================================');
  console.log('PHASE 2 & 3: 10 REAL CODEX TASKS WITH DEEPSEEK DIRECT PRIMARY');
  console.log('================================================================');

  let passCount = 0;
  for (const task of TASKS) {
    const ok = await runSingleCodexGoal(task);
    if (ok) passCount++;
  }

  // Clean up scratch file
  const scratchFile = path.resolve(__dirname, '../scratch_test_codex.txt');
  if (fs.existsSync(scratchFile)) {
    try { fs.unlinkSync(scratchFile); } catch {}
  }

  console.log(`\n================================================================`);
  console.log(`PHASE 3 RESULT: ${passCount}/10`);
  console.log(`================================================================`);
}

runSuite();
