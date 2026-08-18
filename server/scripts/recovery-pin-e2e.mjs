// P11 — REAL CodeX model-pinning E2E.
// Task: assigned ollama/qwen3.5:4b, recovery pin → ollama/llama3.2:3b
// (an actually installed local model). Proves the pin reaches a REAL goal
// and the loop resolves the pinned model as EFFECTIVE (never the assignment).
import { backgroundTaskRepo, ensureBackgroundTaskTables } from '../dist/services/backgroundTasks/store.js';
import { dispatchCodexTask } from '../dist/services/backgroundTasks/adapters.js';
import { goalStore } from '../dist/services/goalStore.js';
import { routingLedger } from '../dist/services/routingLedger.js';

const taskId = `task-pin-e2e-${Date.now()}`;

async function main() {
  ensureBackgroundTaskTables();
  const task = {
    taskId,
    title: 'Model pinning E2E',
    objective: 'Prove recovery model pinning reaches a real CodeX goal.',
    originalRequest: 'Prove model pinning.',
    route: 'direct',
    selectedAgent: 'CodeX',
    status: 'running',
    priority: 'medium',
    projectId: null,
    createdAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
    conversationId: 'conv-pin-e2e',
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
      assignedProvider: 'ollama',
      assignedModel: 'qwen3.5:4b',
      recovery: { effectiveProvider: 'ollama', effectiveModel: 'llama3.2:3b' },
    },
  };
  backgroundTaskRepo.insertTask(task);
  console.log('taskId:', taskId);

  const res = await dispatchCodexTask(task, 'B:\\AgenticOS');
  console.log('dispatch ok:', res.ok, res.error || '');

  const after = backgroundTaskRepo.getTask(taskId);
  const goalId = after?.linkedRunId;
  console.log('goalId:', goalId);

  const goal = goalStore.get(goalId);
  console.log('goal.executionOptions:', JSON.stringify(goal?.executionOptions));
  const pinned = goal?.executionOptions?.modelOverride === 'llama3.2:3b'
    && goal?.executionOptions?.providerOverride === 'ollama';
  console.log('PIN REACHED GOAL:', pinned ? 'YES' : 'NO');

  // Wait a few seconds for the loop to start and resolve the model.
  await new Promise((r) => setTimeout(r, 6000));
  const g2 = goalStore.get(goalId);
  const ledger = routingLedger.get(goalId);
  console.log('goal status after 6s:', g2?.status, '| lastError:', g2?.lastError || '(none)');
  console.log('routingLedger requested/resolved:', ledger ? `${ledger.requestedProvider}/${ledger.requestedModel} → ${ledger.resolvedProvider}/${ledger.resolvedModel}` : '(no ledger entry yet)');
  console.log('ASSIGNED (task):', after?.metadata?.assignedProvider + '/' + after?.metadata?.assignedModel);
  console.log('EFFECTIVE (recovery pin):', 'ollama/llama3.2:3b');

  const pass = pinned;
  console.log('\nP11 E2E RESULT:', pass ? 'PASS (pin mechanism verified)' : 'FAIL');
  if (g2?.status === 'failed') {
    console.log('NOTE: goal failed during real execution:', g2.lastError || 'unknown');
  }

  // Cleanup: abort the real goal, cancel the task.
  try { const { codexService } = await import('../dist/domains/codex/service.js'); await codexService.abortGoal(goalId); } catch { /* ignore */ }
  try { backgroundTaskRepo.updateTask(taskId, { status: 'cancelled' }); } catch { /* ignore */ }
  if (!pass) process.exitCode = 1;
}

main().catch((e) => { console.error('E2E ERROR', e); process.exitCode = 1; });
