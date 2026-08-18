import * as fs from 'fs';
import * as path from 'path';

const BASE = 'http://localhost:4000';

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

interface RunResult {
  taskName: string;
  goalId: string;
  success: boolean;
  durationMs: number;
  tools: string[];
  summary: string;
  error?: string;
  requestChars?: number;
}

async function runGoal(prompt: string, taskName: string, timeoutLimitMs = 60000): Promise<RunResult> {
  console.log(`\n================================================================`);
  console.log(`RUNNING: ${taskName}`);
  console.log(`================================================================`);
  const startTime = Date.now();

  const createRes = await fetch(`${BASE}/api/chat/agents/goals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agentId: 'agent-codex',
      goal: prompt,
      requiresApproval: false
    })
  });

  if (!createRes.ok) {
    console.error('Failed to create goal:', createRes.status);
    return { taskName, goalId: 'none', success: false, durationMs: 0, tools: [], summary: '', error: `HTTP ${createRes.status}` };
  }

  const { goalId } = await createRes.json();
  console.log(`Created Goal ID: ${goalId}`);

  let finalGoal: any = null;
  const timeoutAt = Date.now() + timeoutLimitMs;
  while (Date.now() < timeoutAt) {
    await sleep(1000);
    const gRes = await fetch(`${BASE}/api/chat/agents/goals/${goalId}`);
    if (gRes.ok) {
      finalGoal = await gRes.json();
      if (['completed', 'failed', 'stopped', 'paused'].includes(finalGoal.status)) {
        break;
      }
    }
  }

  const durationMs = Date.now() - startTime;
  if (!finalGoal || !['completed', 'failed', 'stopped', 'paused'].includes(finalGoal.status)) {
    console.error(`Goal ${goalId} timed out after ${durationMs}ms`);
    return { taskName, goalId, success: false, durationMs, tools: [], summary: '', error: 'TIMED_OUT' };
  }

  const history = finalGoal.history || [];
  const finishEvt = history.find((e: any) => e.state === 'completed' || e.tool === 'finish' || e.eventType === 'agent_completed');
  const summary = finishEvt?.message || finalGoal.runSummary || '';
  const success = finalGoal.status === 'completed';
  const tools = history.filter((e: any) => e.state === 'tool_started').map((e: any) => e.tool);

  console.log(`Goal Status: ${finalGoal.status}`);
  console.log(`Duration: ${durationMs}ms`);
  console.log(`Tools (${tools.length}): ${tools.join(' -> ')}`);
  console.log(`Summary Preview: ${summary.slice(0, 200)}...`);

  return { taskName, goalId, success, durationMs, tools, summary };
}

async function main() {
  const results: RunResult[] = [];

  console.log('################################################################');
  console.log('PHASE 20: REAL-WORLD ACCEPTANCE TASKS (A to E)');
  console.log('################################################################');

  // Task A: Simple Read
  results.push(await runGoal(
    'READ-ONLY: Inspect B:\\AgenticOS\\package.json and tell me the project name.',
    'TASK A — Simple Read: root package.json project name'
  ));

  // Task B: Multi-File
  results.push(await runGoal(
    'READ-ONLY: Inspect B:\\AgenticOS\\package.json and B:\\AgenticOS\\server\\package.json and compare their purposes and dependencies.',
    'TASK B — Multi-File: Root vs Server package.json comparison'
  ));

  // Task C: Repository Discovery
  results.push(await runGoal(
    'READ-ONLY: Inspect B:\\AgenticOS and identify the main top-level source components.',
    'TASK C — Repository Discovery: Top-level source components'
  ));

  // Task D: Cross-File Architecture
  results.push(await runGoal(
    'READ-ONLY: Inspect the Electron backend lifecycle and the server entry point and explain how Agentic OS starts the packaged backend.',
    'TASK D — Cross-File Architecture: Electron backend lifecycle & server entry point'
  ));

  // Task E: Feature Analysis
  results.push(await runGoal(
    `READ-ONLY: Inspect B:\\AgenticOS and identify ONE concrete unfinished product feature that can be completed end-to-end.
Return:
1. feature name
2. why it should be next
3. current implementation state
4. exact files involved
5. what is missing
6. smallest useful milestone
7. implementation plan
8. risks
9. estimated scope
10. acceptance test`,
    'TASK E — Feature Analysis: 10-point concrete feature identification'
  ));

  console.log('\n################################################################');
  console.log('PHASE 21: CONTROLLED WRITE TASK');
  console.log('################################################################');

  const scratchDir = path.resolve('B:/AgenticOS/scratch');
  if (!fs.existsSync(scratchDir)) fs.mkdirSync(scratchDir, { recursive: true });
  const writeTarget = 'B:\\AgenticOS\\scratch\\codex_real_acceptance.txt';
  if (fs.existsSync(writeTarget)) fs.unlinkSync(writeTarget);

  const writeTaskRes = await runGoal(
    'Write a file at B:\\AgenticOS\\scratch\\codex_real_acceptance.txt with the exact content "CODEX REAL ACCEPTANCE PASS". Then read it back to verify the content and call finish.',
    'PHASE 21 — Controlled Write & Verify'
  );
  results.push(writeTaskRes);

  const fileExists = fs.existsSync(writeTarget);
  const fileContent = fileExists ? fs.readFileSync(writeTarget, 'utf-8').trim() : '';
  const writeVerified = fileExists && fileContent === 'CODEX REAL ACCEPTANCE PASS';
  console.log(`Write verification check: Exists=${fileExists}, Content="${fileContent}", Verified=${writeVerified}`);

  console.log('\n################################################################');
  console.log('PHASE 23: 10 REAL MIXED TASKS');
  console.log('################################################################');

  const mixedTasks = [
    'READ-ONLY: Inspect B:\\AgenticOS\\tsconfig.json and summarize the compiler options.',
    'READ-ONLY: Inspect B:\\AgenticOS\\server\\tsconfig.json and identify module and target settings.',
    'READ-ONLY: Inspect B:\\AgenticOS\\server\\src\\index.ts and list the mounted routers.',
    'READ-ONLY: Inspect B:\\AgenticOS\\vite.config.ts and summarize the plugins configured.',
    'READ-ONLY: Inspect B:\\AgenticOS\\electron\\main.ts and describe window creation options.',
    'READ-ONLY: Inspect B:\\AgenticOS\\src\\App.tsx and summarize the top-level routing or views.',
    'READ-ONLY: Inspect B:\\AgenticOS\\server\\src\\services\\llmGateway.ts and identify supported provider types.',
    'READ-ONLY: Inspect B:\\AgenticOS\\server\\src\\loops\\codexLoop.ts and explain how tools are parsed.',
    'READ-ONLY: Inspect B:\\AgenticOS\\server\\src\\routers\\health.ts and list the health check endpoints.',
    'READ-ONLY: Inspect B:\\AgenticOS\\server\\src\\db\\schema.ts and list the main database tables.'
  ];

  for (let i = 0; i < mixedTasks.length; i++) {
    results.push(await runGoal(mixedTasks[i], `MIXED TASK ${i + 1}/10`));
  }

  console.log('\n################################################################');
  console.log('PHASE 24: 5-TASK SEQUENTIAL SOAK TEST');
  console.log('################################################################');

  const soakTasks = [
    'READ-ONLY: Inspect B:\\AgenticOS\\package.json and return the scripts.build command.',
    'READ-ONLY: Inspect B:\\AgenticOS\\server\\package.json and return the scripts.dev command.',
    'READ-ONLY: Inspect B:\\AgenticOS\\server\\src\\services\\runStore.ts and summarize run creation logic.',
    'READ-ONLY: Inspect B:\\AgenticOS\\server\\src\\services\\goalStore.ts and summarize checkpoint creation.',
    'READ-ONLY: Inspect B:\\AgenticOS\\server\\src\\utils\\sandbox.ts and list the allowlisted binaries.'
  ];

  for (let i = 0; i < soakTasks.length; i++) {
    results.push(await runGoal(soakTasks[i], `SOAK TASK ${i + 1}/5`));
  }

  console.log('\n================================================================');
  console.log('COMPLETE VERIFICATION SUITE SUMMARY:');
  console.log('================================================================');
  let passCount = 0;
  for (const r of results) {
    const p = r.success ? 'PASS' : 'FAIL';
    if (r.success) passCount++;
    console.log(`${p.padEnd(5)} | ${r.durationMs.toString().padStart(6)}ms | ${r.taskName}`);
  }
  console.log('================================================================');
  console.log(`TOTAL PASS: ${passCount} / ${results.length}`);
  console.log('================================================================');
}

main();
