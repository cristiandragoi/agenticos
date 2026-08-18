// P9 — CodeX LIVE recovery-success E2E (real chain, real model calls).
// assigned ollama/llama3.2:3b → first attempt fails (structured 429) →
// RecoveryPolicy (REAL harness + REAL hardware truth) decides
// escalate_local_model → effective ollama/qwen3.5:4b → REAL goal pinned →
// REAL execution succeeds → gates → verifyCompletion → completed.
import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env'), override: true });

const { backgroundTaskRepo, ensureBackgroundTaskTables } = await import('../dist/services/backgroundTasks/store.js');
const { backgroundTaskManager } = await import('../dist/services/backgroundTasks/manager.js');
const { dispatchCodexTask } = await import('../dist/services/backgroundTasks/adapters.js');
const { goalStore } = await import('../dist/services/goalStore.js');
const { runLedger } = await import('../dist/services/runLedger.js');
import * as executionState from '../dist/services/executionState.js';

const taskId = `task-reclive-${Date.now()}`;
const opId = `op-reclive-${Date.now()}`;

async function waitForTerminal(goalId, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const g = goalStore.get(goalId);
    if (g && (g.status === 'completed' || g.status === 'failed' || g.status === 'stopped')) {
      return g;
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  return goalStore.get(goalId);
}

async function main() {
  ensureBackgroundTaskTables();
  // Prevent the manager queue from double-dispatching; we dispatch directly.
  backgroundTaskManager.pumpQueuedForWorker = async () => {};

  const task = {
    taskId,
    title: 'Live recovery E2E',
    objective: 'Use the read_file tool to read the file at B:\\AgenticOS\\README.md and reply with its first 3 lines. Do not modify anything.',
    originalRequest: 'Use the read_file tool to read the file at B:\\AgenticOS\\README.md and reply with its first 3 lines. Do not modify anything.',
    route: 'direct',
    selectedAgent: 'CodeX',
    status: 'running',
    priority: 'medium',
    projectId: null,
    createdAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
    conversationId: 'conv-reclive',
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
    metadata: {
      operationId: opId,
      approvalPolicy: 'auto',
      assignedProvider: 'ollama',
      assignedModel: 'llama3.2:3b',
      // Force the retryable failure onto the escalation branch (same-model
      // retries already consumed) so RecoveryPolicy must decide.
      recovery: {
        executionAttempts: 1,
        gateReworkAttempts: 0,
        sameModelRetries: 2,
        modelEscalations: 0,
        startedAtMs: Date.now(),
      },
    },
  };
  backgroundTaskRepo.insertTask(task);
  console.log('taskId:', taskId);
  executionState.begin({ operationId: opId, worker: 'codex' });

  // ── Attempt 1 fails with a structured retryable error ────────────────
  const decision = await backgroundTaskManager.recoverAfterFailure(taskId, new Error('HTTP 429 rate limit'));
  console.log('recovery decision:', decision?.kind, '| effective:', decision?.effectiveProvider + '/' + decision?.effectiveModel);
  console.log('escalationOccurred:', decision?.escalationOccurred, '| reason:', decision?.escalationReason);
  const t1 = backgroundTaskRepo.getTask(taskId);
  console.log('after decision → status:', t1.status, 'attempt:', t1.attempt);

  // ── Real re-dispatch with the pinned model ───────────────────────────
  const res = await dispatchCodexTask(t1, 'B:\\AgenticOS');
  console.log('dispatch ok:', res.ok, res.error || '');
  const goalId = backgroundTaskRepo.getTask(taskId)?.linkedRunId;
  console.log('goalId:', goalId);
  const goal = goalStore.get(goalId);
  console.log('goal.executionOptions:', JSON.stringify(goal?.executionOptions));

  const g = await waitForTerminal(goalId, 180000);
  console.log('goal terminal status:', g?.status);
  if (g?.status !== 'completed') {
    const last = (g?.history || []).slice(-1)[0];
    console.log('goal last event:', JSON.stringify(last || null).slice(0, 300));
  }
  // REAL LLM event evidence — the event carries the actual provider/model.
  const planEvent = (g?.history || []).find((h) => h.tool === 'plan');
  console.log('REAL plan event provider/model:', planEvent ? `${planEvent.provider}/${planEvent.model}` : '(none)');

  // Adapter listener runs verifyCompletion async — give it a moment.
  await new Promise((r) => setTimeout(r, 3000));

  const after = backgroundTaskRepo.getTask(taskId);
  console.log('\ntask final status:', after?.status);
  console.log('verificationState:', after?.verificationState);
  console.log('resultText:', (after?.resultText || '').slice(0, 80));

  const ledger = runLedger.getTaskRun(taskId);
  console.log('\nRunLedger status:', ledger?.status);
  console.log('assigned:', ledger?.assignedProvider + '/' + ledger?.assignedModel);
  console.log('effective:', ledger?.effectiveProvider + '/' + ledger?.effectiveModel);
  console.log('escalationOccurred:', ledger?.escalationOccurred);
  const recEvents = ledger?.events || [];
  console.log('recovery events:', recEvents.filter((e) => String(e.kind).startsWith('run.recovery')).map((e) => e.kind).join(', ') || '(none)');

  const active = executionState.snapshot();
  console.log('\nACTIVE RUN current:', active?.operationId === opId ? 'STALE!' : '(cleared)');

  const pass = decision?.kind === 'escalate_local_model'
    && decision?.effectiveModel === 'qwen3.5:4b'
    && g?.status === 'completed'
    && planEvent?.provider === 'ollama'
    && planEvent?.model === 'qwen3.5:4b'
    && after?.status === 'completed'
    && after?.verificationState === 'passed'
    && active?.operationId !== opId;
  console.log('\nP9 E2E RESULT:', pass ? 'PASS' : 'FAIL');

  // Truthful cleanup — never force a terminal status that did not happen.
  try { backgroundTaskRepo.updateTask(taskId, { status: 'cancelled', blocker: 'E2E cleanup' }); } catch { /* ignore */ }
  if (!pass) process.exitCode = 1;
}

main().catch((e) => { console.error('P9 E2E ERROR', e?.message); process.exitCode = 1; });
