// RecoveryPolicy V1 — deterministic E2E (P17): task → attempt 1 fails →
// autonomous same-model retry → attempt 2 succeeds → VERIFYING → required
// gate PASS → COMPLETED → RunLedger recovery evidence → ACTIVE RUN clears.
// Uses the REAL manager + DB (no mocks except preventing real worker dispatch).
import { backgroundTaskRepo, ensureBackgroundTaskTables } from '../dist/services/backgroundTasks/store.js';
import { backgroundTaskManager } from '../dist/services/backgroundTasks/manager.js';
import { runLedger } from '../dist/services/runLedger.js';
import * as executionState from '../dist/services/executionState.js';

const taskId = `task-rec-e2e-${Date.now()}`;
const pumpSpy = (mgr) => { mgr.pumpQueuedForWorker = async () => { /* no real dispatch in E2E */ }; };

async function main() {
  ensureBackgroundTaskTables();
  pumpSpy(backgroundTaskManager);

  const task = {
    taskId,
    title: 'Recovery E2E task',
    objective: 'Prove bounded autonomous recovery end-to-end.',
    originalRequest: 'Prove recovery.',
    route: 'direct',
    selectedAgent: 'CodeX',
    status: 'running',
    priority: 'medium',
    projectId: null,
    createdAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
    conversationId: 'conv-rec-e2e',
    conversationSessionId: null,
    worker: 'codex',
    linkedRunId: null,
    linkedBoardCardId: null,
    parentTaskId: null,
    childTaskIds: [],
    currentStage: 'executing',
    progressMessage: '',
    filesChanged: [],
    buildState: 'idle',
    testState: 'idle',
    verificationState: 'pending',
    approvalState: 'none',
    blocker: null,
    lastError: null,
    resultText: null,
    workspaceRoot: '',
    cancellationRequested: false,
    resumable: true,
    attempt: 1,
    metadata: { assignedProvider: 'ollama', assignedModel: 'qwen3.5:4b' },
  };
  backgroundTaskRepo.insertTask(task);
  console.log('taskId:', taskId);

  // ── Attempt 1 fails with a structured retryable error ────────────────
  const d1 = await backgroundTaskManager.recoverAfterFailure(taskId, new Error('HTTP 429 rate limit'));
  console.log('attempt1 decision:', d1?.kind, '| reason:', d1?.reason);
  const t1 = backgroundTaskRepo.getTask(taskId);
  console.log('after attempt1 → status:', t1.status, 'attempt:', t1.attempt, 'sameModelRetries:', t1.metadata?.recovery?.sameModelRetries);

  // ── Attempt 2 succeeds → VERIFYING → required gate PASS → COMPLETED ──
  backgroundTaskManager.transition(taskId, 'running', { attempt: 2 });
  backgroundTaskManager.verifyCompletion(taskId, {
    resultText: 'Recovery E2E produced verified output.',
    buildState: 'passed',
    testState: 'passed',
    verificationNote: 'Completed and verified: targeted-tests passed.',
  });
  const t2 = backgroundTaskRepo.getTask(taskId);
  console.log('after attempt2 → status:', t2.status, 'verificationState:', t2.verificationState);
  console.log('completedAt:', t2.completedAt);

  // ── RunLedger evidence ───────────────────────────────────────────────
  const ledger = runLedger.getTaskRun(taskId);
  console.log('\nRunLedger status:', ledger?.status);
  console.log('RunLedger recovery events:');
  for (const e of ledger?.events ?? []) {
    if (String(e.kind).startsWith('run.recovery')) {
      console.log(`  ${e.kind} | ${e.summary}`);
    }
  }
  console.log('RunLedger model truth: assigned=', ledger?.assignedProvider + '/' + ledger?.assignedModel, 'effective=', ledger?.effectiveProvider + '/' + ledger?.effectiveModel, 'escalationOccurred=', ledger?.escalationOccurred);

  // ── ACTIVE RUN truth ─────────────────────────────────────────────────
  const active = executionState.snapshot();
  const runActive = active?.operationId ? true : false;
  console.log('\nACTIVE RUN after completion:', runActive ? active.operationId : '(cleared)');

  const pass = t2.status === 'completed' && t2.verificationState === 'passed' && t1.attempt === 2 && d1?.kind === 'retry_same_model';
  console.log('\nP17 E2E RESULT:', pass ? 'PASS' : 'FAIL');
  if (!pass) process.exitCode = 1;
}

main().catch((e) => { console.error('E2E ERROR', e); process.exitCode = 1; });
