import fs from 'fs';
import path from 'path';

interface GoalEvent {
  state: string;
  message: string;
  eventType?: string;
  tool?: string;
  errorCode?: string;
}

interface GoalResponse {
  id: string;
  status: string;
  originalGoal: string;
  history: GoalEvent[];
}

const BASE_URL = 'http://localhost:4000';
const SCRATCH_DIR = path.resolve('scratch-test-codex');

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createAndRunGoal(taskPrompt: string, expectedTool?: string): Promise<{ success: boolean; goalId: string; status: string; turns: number; error?: string }> {
  if (!fs.existsSync(SCRATCH_DIR)) {
    fs.mkdirSync(SCRATCH_DIR, { recursive: true });
  }

  const res = await fetch(`${BASE_URL}/api/chat/agents/goals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      goal: taskPrompt,
      workspacePath: SCRATCH_DIR,
      approvalPolicy: 'auto'
    }),
  });

  const body: any = await res.json().catch(() => ({}));
  const goalId = body.goalId || body.id;
  if (!goalId) {
    return { success: false, goalId: '', status: 'create_failed', turns: 0, error: `No goalId returned: ${JSON.stringify(body)}` };
  }

  // Poll until terminal state
  const startTime = Date.now();
  let goal: GoalResponse | null = null;
  let pollTurns = 0;

  while (Date.now() - startTime < 60000) {
    await sleep(800);
    pollTurns++;
    const gRes = await fetch(`${BASE_URL}/api/chat/agents/goals/${goalId}`);
    if (!gRes.ok) continue;
    goal = (await gRes.json()) as GoalResponse;
    if (['completed', 'failed', 'stopped', 'paused', 'cancelled'].includes(goal.status)) {
      break;
    }
  }

  if (!goal) {
    return { success: false, goalId, status: 'timeout', turns: pollTurns, error: 'Goal poll timed out' };
  }

  const fatalErrors = (goal.history || []).filter((e) => e.state === 'failed' || e.eventType === 'task_failed');
  const retries = (goal.history || []).filter((e) => e.eventType === 'retry_started').length;
  const isOk = goal.status === 'completed' && fatalErrors.length === 0;

  return {
    success: isOk,
    goalId,
    status: goal.status,
    turns: pollTurns,
    error: fatalErrors.length > 0 ? (fatalErrors[0].error || fatalErrors[0].message) : (goal.status !== 'completed' ? `Terminated with status: ${goal.status}` : undefined)
  };
}

async function testCancellation(): Promise<boolean> {
  if (!fs.existsSync(SCRATCH_DIR)) {
    fs.mkdirSync(SCRATCH_DIR, { recursive: true });
  }

  // Create a goal
  const res = await fetch(`${BASE_URL}/api/chat/agents/goals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      goal: 'Write 10 sequential log lines to scratch-test-codex/long_log.txt and verify each line carefully.',
      workspacePath: SCRATCH_DIR,
      approvalPolicy: 'auto'
    }),
  });

  const body: any = await res.json().catch(() => ({}));
  const goalId = body.goalId || body.id;
  if (!goalId) return false;

  await sleep(400);

  // Send Stop / Cancel
  const cancelRes = await fetch(`${BASE_URL}/api/execution/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operationId: goalId })
  });

  const cancelJson: any = await cancelRes.json().catch(() => ({}));
  console.log('Cancellation dispatch response:', cancelJson);

  // Wait for state reconciliation
  await sleep(1500);

  const goalRes = await fetch(`${BASE_URL}/api/chat/agents/goals/${goalId}`);
  const finalGoal: any = await goalRes.json();
  console.log(`Goal ${goalId} status after cancellation:`, finalGoal.status);

  return ['stopped', 'paused', 'cancelled'].includes(finalGoal.status);
}

async function main() {
  console.log('====================================================');
  console.log('STARTING CODEX 10-RUN RELIABILITY & RETENTION VERIFICATION');
  console.log('====================================================\n');

  const testPrompts = [
    'Inspect package.json and count how many dependencies are defined. Do not modify files.',
    'Inspect server/package.json and explain what scripts are available. Do not modify files.',
    'Write a JSON file named test_1.json in the current directory with content: {"run": 1, "status": "ok"}.',
    'Write a text file named notes_1.txt in the current directory with content: CodeX execution verified run 2.',
    'Read test_1.json and report what the status property contains. Do not modify files.',
    'Write a JSON file named test_2.json in the current directory with content: {"run": 2, "verified": true}.',
    'Inspect README.md or package.json in the root and summarize what project this is.',
    'Write a file named config_sample.json in the current directory with content: {"service": "codex", "port": 4000}.',
    'Read test_2.json and verify that verified is true. Do not modify files.',
    'Write a summary file named codex_final_summary.txt with content: All 10 verification runs completed successfully.'
  ];

  let passedCount = 0;
  for (let i = 0; i < testPrompts.length; i++) {
    const prompt = testPrompts[i];
    console.log(`--- Run ${i + 1}/${testPrompts.length}: "${prompt.slice(0, 60)}..." ---`);
    const result = await createAndRunGoal(prompt);
    console.log(`Result: ${result.success ? 'PASS' : 'FAIL'} | GoalId: ${result.goalId} | Status: ${result.status} | Turns: ${result.turns} | Error: ${result.error || 'none'}\n`);
    if (result.success) passedCount++;
  }

  console.log(`\n====================================================`);
  console.log(`10-RUN RESULT: ${passedCount}/${testPrompts.length} PASSED`);
  console.log(`====================================================\n`);

  console.log('--- Testing Stop / Cancellation Flow ---');
  const cancelOk = await testCancellation();
  console.log(`Cancellation Test Result: ${cancelOk ? 'PASS' : 'FAIL'}`);

  // Cleanup scratch directory
  try {
    fs.rmSync(SCRATCH_DIR, { recursive: true, force: true });
  } catch {}
}

main().catch(console.error);
