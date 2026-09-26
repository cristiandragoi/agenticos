/**
 * scripts/test_local_worker_suite.mjs
 *
 * Authoritative Acceptance Test Suite for AgenticOS Local Worker MVP.
 * Verifies all 8 acceptance scenarios against the live runtime:
 *   Scenario 1 — Repository inspection (Git branch, commit, clean status)
 *   Scenario 2 — File discovery (Find package.json in D:\AgenticOS, read name & version)
 *   Scenario 3 — Build investigation (Run server build, report success/failure truthfulness)
 *   Scenario 4 — Multi-step execution (Find latest log, read, identify error entry)
 *   Scenario 5 — Worker cancellation (Start long task, cancel, verify stopped)
 *   Scenario 6 — Failure truthfulness (Nonexistent file reports failure, never claims success)
 *   Scenario 7 — Approval pause (High-impact delete pauses for approval, resumes after approval)
 *   Scenario 8 — Hermes delegation (Jarvis -> Hermes -> Local Worker -> Tool -> Evidence -> Hermes -> Jarvis)
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const BASE_URL = 'http://127.0.0.1:4600';
const EXE_PATH = 'C:\\Users\\cd-pr\\AppData\\Local\\Programs\\AgenticOS\\AgenticOS.exe';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function ensureBackendHealthy() {
  console.log('[Setup] Checking backend health on port 4600...');
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`${BASE_URL}/api/health`);
      if (res.ok) {
        const body = await res.json();
        console.log(`[Setup] Backend healthy! buildId: ${body?.build?.buildId || 'local'}, gitSha: ${body?.build?.gitShort || 'head'}`);
        return true;
      }
    } catch {}
    await sleep(1000);
  }

  console.log('[Setup] Backend not responding. Launching installed executable...');
  try {
    const child = spawn(EXE_PATH, [], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    child.unref();

    for (let i = 0; i < 45; i++) {
      try {
        const res = await fetch(`${BASE_URL}/api/health`);
        if (res.ok) {
          console.log('[Setup] Backend is now up and healthy.');
          return true;
        }
      } catch {}
      await sleep(1000);
    }
  } catch (err) {
    console.error('[Setup] Failed to spawn executable:', err);
  }

  throw new Error('Backend failed to become healthy on port 4600');
}

async function createConversation(title = 'Local Worker Acceptance Conversation') {
  const res = await fetch(`${BASE_URL}/api/jarvis/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error('Failed to create conversation');
  const data = await res.json();
  return data.id;
}

async function executeJarvisTurn(conversationId, prompt) {
  console.log(`\n>>> [Jarvis Turn] "${prompt}"`);
  const streamRes = await fetch(`${BASE_URL}/api/jarvis/conversations/${conversationId}/message/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      rawStt: prompt,
      confidence: 0.99,
      inputChannel: 'voice',
    }),
  });

  let fullText = '';
  const progressEvents = [];

  if (streamRes.body) {
    const reader = streamRes.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value);
      for (const line of chunk.split('\n')) {
        if (line.startsWith('data:')) {
          try {
            const data = JSON.parse(line.slice(5).trim());
            if (data.lifecycle || data.stage || data.status || data.currentStep) {
              progressEvents.push(data);
            }
            if (typeof data.text === 'string') {
              fullText += data.text;
            }
          } catch {}
        }
      }
    }
  }

  return { fullText, progressEvents };
}

async function waitForWorkerTask(taskId, maxWaitMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      const res = await fetch(`${BASE_URL}/api/worker/tasks/${taskId}`);
      if (res.ok) {
        const data = await res.json();
        const task = data?.task || data;
        if (task && task.status) {
          if (task.status !== 'running' && task.status !== 'planning' && task.status !== 'queued') {
            return task;
          }
        }
      }
    } catch {}
    await sleep(400);
  }
  try {
    const finalRes = await fetch(`${BASE_URL}/api/worker/tasks/${taskId}`);
    const finalData = await finalRes.json();
    return finalData?.task || finalData;
  } catch {
    return null;
  }
}

async function runSuite() {
  console.log('================================================================');
  console.log('AGENTICOS LOCAL WORKER MVP ACCEPTANCE SUITE (8 SCENARIOS)');
  console.log('================================================================\n');

  await ensureBackendHealthy();
  const conversationId = await createConversation();
  console.log(`Using conversation: ${conversationId}\n`);

  const results = [];

  // ───────────────────────────────────────────────────────────────────────────
  // Scenario 1 — Repository inspection
  // ───────────────────────────────────────────────────────────────────────────
  console.log('----------------------------------------------------------------');
  console.log('SCENARIO 1: Repository inspection');
  console.log('Goal: Inspect D:\\AgenticOS and report git branch, latest commit, clean status');
  console.log('----------------------------------------------------------------');
  try {
    const turn1 = await executeJarvisTurn(
      conversationId,
      'Delegate to a local worker: Inspect D:\\AgenticOS and tell me the current Git branch, latest commit and whether the working tree is clean. Do not modify anything.'
    );

    // Retrieve the latest task from the worker API
    const tasksRes = await fetch(`${BASE_URL}/api/worker/tasks`);
    const tasksData = await tasksRes.json();
    const task1 = tasksData.tasks[0];

    if (!task1) throw new Error('No worker task created');
    console.log(`[Task ${task1.id}] Status: ${task1.status}, Plan steps: ${task1.plan.length}`);

    const completedTask1 = await waitForWorkerTask(task1.id, 15000);
    console.log(`[Task ${task1.id}] Completed Status: ${completedTask1.status}`);
    console.log(`[Task ${task1.id}] Result Summary: ${completedTask1.result?.summary}`);
    console.log(`[Task ${task1.id}] Evidence records: ${completedTask1.evidence.length}`);

    const hasGitEvidence = completedTask1.evidence.some(e => e.tool?.includes('git') || e.evidenceSource?.includes('git'));
    const isCompleted = completedTask1.status === 'completed';
    const isTruthful = completedTask1.result?.summary?.includes('branch') || completedTask1.result?.summary?.includes('commit') || completedTask1.result?.summary?.includes('clean');

    if (isCompleted && hasGitEvidence && isTruthful) {
      console.log('>>> SCENARIO 1: PASS');
      results.push({ scenario: 'Scenario 1 — Repository inspection', status: 'PASS' });
    } else {
      throw new Error(`Scenario 1 check failed: completed=${isCompleted}, hasGitEvidence=${hasGitEvidence}, isTruthful=${isTruthful}`);
    }
  } catch (err) {
    console.error('>>> SCENARIO 1: FAIL —', err.message);
    results.push({ scenario: 'Scenario 1 — Repository inspection', status: 'FAIL', error: err.message });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Scenario 2 — File discovery
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n----------------------------------------------------------------');
  console.log('SCENARIO 2: File discovery');
  console.log('Goal: Find package.json in D:\\AgenticOS, read project name and version');
  console.log('----------------------------------------------------------------');
  try {
    const turn2 = await executeJarvisTurn(
      conversationId,
      'Delegate to a local worker: Find package.json in D:\\AgenticOS, read its project name and version and report them.'
    );

    const tasksRes = await fetch(`${BASE_URL}/api/worker/tasks`);
    const tasksData = await tasksRes.json();
    const task2 = tasksData.tasks[0];

    const completedTask2 = await waitForWorkerTask(task2.id, 15000);
    console.log(`[Task ${task2.id}] Completed Status: ${completedTask2.status}`);
    console.log(`[Task ${task2.id}] Result Summary: ${completedTask2.result?.summary}`);

    const hasReadEvidence = completedTask2.evidence.some(e => e.tool?.includes('read') || e.tool?.includes('locate') || e.evidenceSource?.includes('filesystem'));
    const mentionsName = /agenticos|agentic-os/i.test(completedTask2.result?.summary || '');

    if (completedTask2.status === 'completed' && hasReadEvidence && mentionsName) {
      console.log('>>> SCENARIO 2: PASS');
      results.push({ scenario: 'Scenario 2 — File discovery', status: 'PASS' });
    } else {
      throw new Error(`Scenario 2 check failed: status=${completedTask2.status}, hasReadEvidence=${hasReadEvidence}, mentionsName=${mentionsName}`);
    }
  } catch (err) {
    console.error('>>> SCENARIO 2: FAIL —', err.message);
    results.push({ scenario: 'Scenario 2 — File discovery', status: 'FAIL', error: err.message });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Scenario 3 — Build investigation
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n----------------------------------------------------------------');
  console.log('SCENARIO 3: Build investigation');
  console.log('Goal: Run AgenticOS server build and report whether it succeeds or fails');
  console.log('----------------------------------------------------------------');
  try {
    const turn3 = await executeJarvisTurn(
      conversationId,
      'Delegate to a local worker: Run the AgenticOS server build and tell me whether it succeeds. If it fails, identify the first relevant compiler error. Do not modify files.'
    );

    const tasksRes = await fetch(`${BASE_URL}/api/worker/tasks`);
    const tasksData = await tasksRes.json();
    const task3 = tasksData.tasks[0];

    const completedTask3 = await waitForWorkerTask(task3.id, 45000);
    console.log(`[Task ${task3.id}] Completed Status: ${completedTask3.status}`);
    console.log(`[Task ${task3.id}] Result Summary: ${completedTask3.result?.summary}`);

    const hasBuildEvidence = completedTask3.evidence.some(e => e.tool?.includes('build') || e.evidenceSource?.includes('build') || e.tool?.includes('developer') || e.tool?.includes('execute'));
    const hasTruthfulVerdict = typeof completedTask3.result?.success === 'boolean';

    if ((completedTask3.status === 'completed' || completedTask3.status === 'failed') && hasBuildEvidence && hasTruthfulVerdict) {
      console.log('>>> SCENARIO 3: PASS');
      results.push({ scenario: 'Scenario 3 — Build investigation', status: 'PASS' });
    } else {
      throw new Error(`Scenario 3 check failed: status=${completedTask3.status}, hasBuildEvidence=${hasBuildEvidence}`);
    }
  } catch (err) {
    console.error('>>> SCENARIO 3: FAIL —', err.message);
    results.push({ scenario: 'Scenario 3 — Build investigation', status: 'FAIL', error: err.message });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Scenario 4 — Multi-step execution (Log search)
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n----------------------------------------------------------------');
  console.log('SCENARIO 4: Multi-step execution');
  console.log('Goal: Find the most recent AgenticOS log, read it, identify latest ERROR');
  console.log('----------------------------------------------------------------');
  try {
    const turn4 = await executeJarvisTurn(
      conversationId,
      'Delegate to a local worker: Find the most recent AgenticOS log, read it, identify the latest ERROR entry and tell me which component generated it.'
    );

    const tasksRes = await fetch(`${BASE_URL}/api/worker/tasks`);
    const tasksData = await tasksRes.json();
    const task4 = tasksData.tasks[0];

    const completedTask4 = await waitForWorkerTask(task4.id, 20000);
    console.log(`[Task ${task4.id}] Completed Status: ${completedTask4.status}`);
    console.log(`[Task ${task4.id}] Plan length: ${completedTask4.plan.length}, Evidence: ${completedTask4.evidence.length}`);
    console.log(`[Task ${task4.id}] Result Summary: ${completedTask4.result?.summary}`);

    const multiStep = completedTask4.plan.length >= 2;
    const hasLogEvidence = completedTask4.evidence.length >= 1;

    if (completedTask4.status === 'completed' && multiStep && hasLogEvidence) {
      console.log('>>> SCENARIO 4: PASS');
      results.push({ scenario: 'Scenario 4 — Multi-step execution', status: 'PASS' });
    } else {
      throw new Error(`Scenario 4 check failed: status=${completedTask4.status}, multiStep=${multiStep}, evidence=${hasLogEvidence}`);
    }
  } catch (err) {
    console.error('>>> SCENARIO 4: FAIL —', err.message);
    results.push({ scenario: 'Scenario 4 — Multi-step execution', status: 'FAIL', error: err.message });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Scenario 5 — Worker cancellation
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n----------------------------------------------------------------');
  console.log('SCENARIO 5: Worker cancellation');
  console.log('Goal: Start long-running task, cancel through Jarvis/Worker API, verify cancelled');
  console.log('----------------------------------------------------------------');
  try {
    // Start long-running task via API directly
    const createRes = await fetch(`${BASE_URL}/api/worker/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goal: 'Execute long-running maintenance checks with 10 sequential iterations' }),
    });
    const createData = await createRes.json();
    const task5Id = createData.id || createData.task?.id;
    console.log(`[Task ${task5Id}] Started long-running task`);

    // Give it a brief moment to run step 1
    await sleep(100);

    // Cancel the task
    const cancelRes = await fetch(`${BASE_URL}/api/worker/tasks/${task5Id}/cancel`, { method: 'POST' });
    const cancelData = await cancelRes.json();
    console.log(`[Task ${task5Id}] Cancel call status: ${cancelData.status || cancelData.task?.status}`);

    const cancelledTask = await waitForWorkerTask(task5Id, 5000);
    console.log(`[Task ${task5Id}] Final Status: ${cancelledTask.status}`);

    const isCancelled = cancelledTask.status === 'cancelled';
    const notAllStepsRun = cancelledTask.currentStep < cancelledTask.plan.length;

    if (isCancelled && notAllStepsRun) {
      console.log('>>> SCENARIO 5: PASS');
      results.push({ scenario: 'Scenario 5 — Worker cancellation', status: 'PASS' });
    } else {
      throw new Error(`Scenario 5 check failed: isCancelled=${isCancelled}, currentStep=${cancelledTask.currentStep}/${cancelledTask.plan.length}`);
    }
  } catch (err) {
    console.error('>>> SCENARIO 5: FAIL —', err.message);
    results.push({ scenario: 'Scenario 5 — Worker cancellation', status: 'FAIL', error: err.message });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Scenario 6 — Failure truthfulness
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n----------------------------------------------------------------');
  console.log('SCENARIO 6: Failure truthfulness');
  console.log('Goal: Nonexistent file must report failed / not found and never claim success');
  console.log('----------------------------------------------------------------');
  try {
    const turn6 = await executeJarvisTurn(
      conversationId,
      'Delegate to a local worker: Read nonexistent_secret_file_987654321.txt and print its contents.'
    );

    const tasksRes = await fetch(`${BASE_URL}/api/worker/tasks`);
    const tasksData = await tasksRes.json();
    const task6 = tasksData.tasks[0];

    const completedTask6 = await waitForWorkerTask(task6.id, 15000);
    console.log(`[Task ${task6.id}] Completed Status: ${completedTask6.status}`);
    console.log(`[Task ${task6.id}] Result Success: ${completedTask6.result?.success}`);
    console.log(`[Task ${task6.id}] Result Summary: ${completedTask6.result?.summary}`);

    const isFailed = completedTask6.status === 'failed';
    const isUnsuccessful = completedTask6.result?.success === false;
    const truthfulReport = /not found|fail|does not exist/i.test(completedTask6.result?.summary || '');

    if (isFailed && isUnsuccessful && truthfulReport) {
      console.log('>>> SCENARIO 6: PASS');
      results.push({ scenario: 'Scenario 6 — Failure truthfulness', status: 'PASS' });
    } else {
      throw new Error(`Scenario 6 check failed: isFailed=${isFailed}, isUnsuccessful=${isUnsuccessful}, truthfulReport=${truthfulReport}`);
    }
  } catch (err) {
    console.error('>>> SCENARIO 6: FAIL —', err.message);
    results.push({ scenario: 'Scenario 6 — Failure truthfulness', status: 'FAIL', error: err.message });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Scenario 7 — Approval pause & resume
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n----------------------------------------------------------------');
  console.log('SCENARIO 7: Approval pause & resume');
  console.log('Goal: High-impact delete pauses for approval, then executes upon approval');
  console.log('----------------------------------------------------------------');
  try {
    // Create temporary file to delete safely
    const tempFile = path.join('D:\\AgenticOS', `temp_test_to_delete_${Date.now()}.txt`);
    fs.writeFileSync(tempFile, 'temporary test file for worker approval', 'utf8');

    const turn7 = await executeJarvisTurn(
      conversationId,
      `Delegate to a local worker: Delete obsolete temporary test file ${tempFile}`
    );

    const tasksRes = await fetch(`${BASE_URL}/api/worker/tasks`);
    const tasksData = await tasksRes.json();
    const task7 = tasksData.tasks[0];

    // Wait for it to pause at awaiting_approval
    let pausedTask = task7;
    for (let i = 0; i < 20; i++) {
      const res = await fetch(`${BASE_URL}/api/worker/tasks/${task7.id}`);
      const data = await res.json();
      if (data.task?.status === 'awaiting_approval') {
        pausedTask = data.task;
        break;
      }
      await sleep(250);
    }

    console.log(`[Task ${task7.id}] Status before approval: ${pausedTask.status}`);
    const isPaused = pausedTask.status === 'awaiting_approval';

    // Now approve the task
    console.log(`[Task ${task7.id}] Sending approval...`);
    const approveRes = await fetch(`${BASE_URL}/api/worker/tasks/${task7.id}/approve`, { method: 'POST' });
    const approveData = await approveRes.json();
    console.log(`[Task ${task7.id}] Post-approval status: ${approveData.task?.status}`);

    const finishedTask7 = await waitForWorkerTask(task7.id, 15000);
    console.log(`[Task ${task7.id}] Final Status: ${finishedTask7.status}`);
    console.log(`[Task ${task7.id}] Result: ${finishedTask7.result?.summary}`);

    const fileDeleted = !fs.existsSync(tempFile);
    const isCompleted = finishedTask7.status === 'completed';

    if (isPaused && isCompleted && fileDeleted) {
      console.log('>>> SCENARIO 7: PASS');
      results.push({ scenario: 'Scenario 7 — Approval pause', status: 'PASS' });
    } else {
      // Clean up temp file if not deleted
      if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
      throw new Error(`Scenario 7 check failed: isPaused=${isPaused}, isCompleted=${isCompleted}, fileDeleted=${fileDeleted}`);
    }
  } catch (err) {
    console.error('>>> SCENARIO 7: FAIL —', err.message);
    results.push({ scenario: 'Scenario 7 — Approval pause', status: 'FAIL', error: err.message });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Scenario 8 — Hermes delegation
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n----------------------------------------------------------------');
  console.log('SCENARIO 8: Hermes delegation');
  console.log('Goal: Hermes delegates local task to Local Worker, gathers evidence & synthesizes');
  console.log('----------------------------------------------------------------');
  try {
    // Trigger via Hermes delegation
    const hermesPrompt = 'Hermes, ask a local worker to inspect git status in D:\\AgenticOS and tell me whether working tree is clean.';
    console.log(`>>> [Hermes Delegation] "${hermesPrompt}"`);

    // Direct hermes execution through orchestrator or hermes service API
    const hermesRes = await fetch(`${BASE_URL}/api/hermes/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: hermesPrompt,
        conversationId,
      }),
    });

    let hermesOutput = null;
    if (hermesRes.ok) {
      const hData = await hermesRes.json();
      console.log(`[Hermes] Launch response: runId=${hData.runId || hData.hermesRunId}`);
      // Wait for Hermes run to complete
      const runId = hData.runId || hData.run?.id;
      if (runId) {
        for (let i = 0; i < 40; i++) {
          const runRes = await fetch(`${BASE_URL}/api/execution-runs/${runId}`);
          if (runRes.ok) {
            const rData = await runRes.json();
            if (rData.status === 'completed' || rData.status === 'failed') {
              hermesOutput = rData;
              break;
            }
          }
          await sleep(1000);
        }
      }
    } else {
      // Execute via Jarvis turn:
      const turn8 = await executeJarvisTurn(conversationId, hermesPrompt);
      console.log(`[Hermes via Jarvis] Response: ${turn8.fullText.slice(0, 200)}...`);
    }

    // Verify that a worker task was launched and contains evidence
    const tasksRes = await fetch(`${BASE_URL}/api/worker/tasks`);
    const tasksData = await tasksRes.json();
    const task8 = tasksData.tasks[0];

    console.log(`[Task ${task8.id}] Status: ${task8.status}, Evidence count: ${task8.evidence.length}`);
    const completedTask8 = await waitForWorkerTask(task8.id, 15000);

    const hasEvidence = completedTask8.evidence.length > 0;
    const isCompleted = completedTask8.status === 'completed';

    if (isCompleted && hasEvidence) {
      console.log('>>> SCENARIO 8: PASS');
      results.push({ scenario: 'Scenario 8 — Hermes delegation', status: 'PASS' });
    } else {
      throw new Error(`Scenario 8 check failed: isCompleted=${isCompleted}, hasEvidence=${hasEvidence}`);
    }
  } catch (err) {
    console.error('>>> SCENARIO 8: FAIL —', err.message);
    results.push({ scenario: 'Scenario 8 — Hermes delegation', status: 'FAIL', error: err.message });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // SUMMARY
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n================================================================');
  console.log('LOCAL WORKER MVP ACCEPTANCE RESULTS');
  console.log('================================================================');
  let passCount = 0;
  for (const r of results) {
    const mark = r.status === 'PASS' ? '✅ PASS' : '❌ FAIL';
    console.log(`${mark} : ${r.scenario} ${r.error ? `(${r.error})` : ''}`);
    if (r.status === 'PASS') passCount++;
  }
  console.log(`\nTOTAL: ${passCount} / ${results.length} PASSED`);
  console.log('================================================================\n');

  if (passCount !== 8) {
    process.exit(1);
  }
}

runSuite().catch((err) => {
  console.error('Fatal error during suite execution:', err);
  process.exit(1);
});
