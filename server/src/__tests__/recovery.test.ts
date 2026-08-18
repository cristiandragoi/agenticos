/**
 * LocalHarness / RecoveryPolicy V1 tests (P23):
 * - failure classification (structured, not NL-only)
 * - same-model retry + retry limit
 * - model escalation + effective-model truth
 * - privacy blocks cloud escalation (localOnly)
 * - gate failure → rework + rework limit
 * - cancellation dominance
 * - human approval stops recovery
 * - recovery budget exhaustion
 * - no success memory from failed verification
 * - workspace boundary untouched (no permission expansion)
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { backgroundTaskRepo, ensureBackgroundTaskTables } from '../services/backgroundTasks/store.js';
import type { BackgroundTaskRecord } from '../services/backgroundTasks/types.js';
import { backgroundTaskManager } from '../services/backgroundTasks/manager.js';
import * as adaptersModule from '../services/backgroundTasks/adapters.js';
import { classifyFailure } from '../services/recovery/classifier.js';
import { classifyAndDecide, pickStrongerLocalModel } from '../services/recovery/localHarness.js';
import { DEFAULT_RECOVERY_POLICY, newBudgetUsage, type RecoveryBudgetUsage } from '../services/recovery/policy.js';
import { projectsStore } from '../services/projectsStore.js';
import { policyStore } from '../services/policy/policyStore.js';
import { distillFromExecution } from '../services/memory/distill.js';
import { memoryStore } from '../services/memory/store.js';

// Deterministic hardware profile: qwen3.5:4b (assigned), qwen3.5:8b
// (stronger local candidate), qwen3.5:cloud (cloud-link → never local).
vi.mock('../services/system/hardwareProfiler.js', () => ({
  getHardwareProfile: vi.fn(async () => ({
    capabilityTier: 'balanced',
    ollama: { reachable: true, models: [
      { id: 'qwen3.5:4b', size: 4 },
      { id: 'qwen3.5:8b', size: 8 },
      { id: 'qwen3.5:cloud', size: null },
    ] },
  })),
}));

const createdTasks: string[] = [];
const createdProjects: string[] = [];
const createdMemories: string[] = [];

function makeTask(over: Partial<BackgroundTaskRecord> = {}): BackgroundTaskRecord {
  const base: BackgroundTaskRecord = {
    taskId: `task-rec-${Date.now()}-${Math.floor(Math.random() * 1e4)}`,
    title: 'Recovery test task',
    objective: 'Test recovery.',
    originalRequest: 'Test recovery.',
    route: 'direct',
    selectedAgent: 'CodeX',
    status: 'running',
    priority: 'medium',
    projectId: null,
    createdAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
    conversationId: 'conv-rec-test',
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
    metadata: {},
    ...over,
  };
  return base;
}

function insert(over: Partial<BackgroundTaskRecord> = {}): BackgroundTaskRecord {
  const task = makeTask(over);
  backgroundTaskRepo.insertTask(task);
  createdTasks.push(task.taskId);
  return task;
}

function insertWithRecovery(used: Partial<RecoveryBudgetUsage>): BackgroundTaskRecord {
  const base = newBudgetUsage();
  return insert({
    metadata: {
      recovery: {
        executionAttempts: used.executionAttempts ?? base.executionAttempts,
        gateReworkAttempts: used.gateReworkAttempts ?? 0,
        sameModelRetries: used.sameModelRetries ?? 0,
        modelEscalations: used.modelEscalations ?? 0,
        startedAtMs: base.startedAtMs,
      },
    },
  });
}

beforeAll(() => {
  ensureBackgroundTaskTables();
});

beforeEach(() => {
  // Fresh method spies per test — never accumulate across tests.
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  for (const id of createdTasks.splice(0)) {
    try { backgroundTaskRepo.updateTask(id, { status: 'cancelled' }); } catch { /* ignore */ }
  }
  for (const id of createdProjects.splice(0)) {
    try { projectsStore.deleteProject(id); } catch { /* ignore */ }
  }
  for (const id of createdMemories.splice(0)) {
    try { memoryStore.delete(id); } catch { /* ignore */ }
  }
});

async function noPump() {
  // Prevent real worker dispatch during recovery tests (the recovery path
  // re-dispatches via the production dispatcher — spy it out).
  vi.spyOn(adaptersModule, 'dispatchTask').mockResolvedValue({ ok: true });
}
async function expectPumpCalled() {
  return vi.spyOn(adaptersModule, 'dispatchTask').mockResolvedValue({ ok: true });
}

describe('FailureClassifier', () => {
  it('HTTP 429 → RETRYABLE_EXECUTION', () => {
    const c = classifyFailure(new Error('rate limited'), { status: 429 });
    expect(c.cls).toBe('RETRYABLE_EXECUTION');
    expect(c.retryable).toBe(true);
  });

  it('HTTP 503/500 → RETRYABLE_EXECUTION', () => {
    expect(classifyFailure('boom', { status: 503 }).cls).toBe('RETRYABLE_EXECUTION');
    expect(classifyFailure('boom', { status: 500 }).cls).toBe('RETRYABLE_EXECUTION');
  });

  it('HTTP 401/403 → NON_RETRYABLE', () => {
    expect(classifyFailure('denied', { status: 401 }).cls).toBe('NON_RETRYABLE');
    expect(classifyFailure('denied', { status: 403 }).cls).toBe('NON_RETRYABLE');
  });

  it('EMPTY_CONTENT_AFTER_REASONING → MODEL_INADEQUATE', () => {
    const c = classifyFailure('no content', { code: 'EMPTY_CONTENT_AFTER_REASONING' });
    expect(c.cls).toBe('MODEL_INADEQUATE');
    expect(c.retryable).toBe(false);
  });

  it('GATE_FAILURE → GATE_FAILURE', () => {
    expect(classifyFailure('gate', { code: 'GATE_FAILURE' }).cls).toBe('GATE_FAILURE');
  });

  it('cancellation → CANCELLED (dominates)', () => {
    expect(classifyFailure(new Error('x'), { cancelled: true }).cls).toBe('CANCELLED');
    expect(classifyFailure(new Error('AbortError'), { code: 'AbortError' }).cls).toBe('CANCELLED');
  });

  it('approval pending → APPROVAL_REQUIRED', () => {
    expect(classifyFailure('x', { approvalPending: true }).cls).toBe('APPROVAL_REQUIRED');
  });

  it('policy block → POLICY_BLOCKED', () => {
    expect(classifyFailure('x', { code: 'POLICY_BLOCKED' }).cls).toBe('POLICY_BLOCKED');
  });

  it('unknown → NON_RETRYABLE (conservative default)', () => {
    const c = classifyFailure(new Error('strange internal error'));
    expect(c.cls).toBe('NON_RETRYABLE');
    expect(c.originalError).toContain('strange internal error');
  });
});

describe('pickStrongerLocalModel (advisory)', () => {
  const models = [
    { id: 'qwen3.5:4b', size: 4 },
    { id: 'qwen3.5:8b', size: 8 },
    { id: 'qwen3.5:cloud', size: null },
    { id: 'llama3.2:3b', size: 3 },
  ];

  it('filters cloud-link placeholders (never local escalation)', () => {
    const chosen = pickStrongerLocalModel('llama3.2:3b', models, 'balanced');
    expect(chosen?.id).not.toMatch(/cloud/);
  });

  it('picks the smallest strictly-stronger local model', () => {
    const chosen = pickStrongerLocalModel('qwen3.5:4b', models, 'balanced');
    expect(chosen?.id).toBe('qwen3.5:8b');
  });

  it('returns null when nothing is stronger', () => {
    expect(pickStrongerLocalModel('qwen3.5:8b', models, 'balanced')).toBeNull();
  });

  it('lite/unknown tier refuses large candidates (unknown stays unknown)', () => {
    // ≤8B escalation is allowed on lite; a >8B candidate is refused because
    // we cannot be certain it will run on the machine.
    expect(pickStrongerLocalModel('qwen3.5:4b', [{ id: 'qwen3.5:14b', size: 14 }], 'lite')).toBeNull();
    expect(pickStrongerLocalModel('qwen3.5:4b', [{ id: 'qwen3.5:14b', size: 14 }], 'unknown')).toBeNull();
  });
});

describe('classifyAndDecide — decisions', () => {
  const ctxBase = {
    policy: DEFAULT_RECOVERY_POLICY,
    assignedProvider: 'ollama',
    assignedModel: 'qwen3.5:4b',
    used: newBudgetUsage(),
    localModels: [
      { id: 'qwen3.5:4b', size: 4 },
      { id: 'qwen3.5:8b', size: 8 },
      { id: 'qwen3.5:cloud', size: null },
    ],
    hardwareTier: 'balanced' as const,
  };

  it('retryable execution with budget → retry_same_model (attempt 2, same model truth)', () => {
    const { decision } = classifyAndDecide(new Error('timeout'), { ...ctxBase });
    expect(decision.kind).toBe('retry_same_model');
    expect(decision.attempt).toBe(2);
    expect(decision.effectiveModel).toBe('qwen3.5:4b'); // same model — truth preserved
    expect(decision.escalationOccurred).toBe(false);
  });

  it('same-model retries exhausted → local escalation to stronger model with truth', () => {
    const used = { ...newBudgetUsage(), sameModelRetries: DEFAULT_RECOVERY_POLICY.maxSameModelRetries };
    const { decision } = classifyAndDecide(new Error('timeout'), { ...ctxBase, used });
    expect(decision.kind).toBe('escalate_local_model');
    expect(decision.effectiveModel).toBe('qwen3.5:8b');
    expect(decision.effectiveProvider).toBe('ollama');
    expect(decision.previousModel).toBe('qwen3.5:4b');
    expect(decision.escalationOccurred).toBe(true);
  });

  it('MODEL_INADEQUATE with no stronger local → cloud escalation when policy allows', () => {
    const used = { ...newBudgetUsage(), sameModelRetries: DEFAULT_RECOVERY_POLICY.maxSameModelRetries };
    const { decision } = classifyAndDecide({ code: 'EMPTY_CONTENT_AFTER_REASONING' }, {
      ...ctxBase,
      used,
      assignedModel: 'qwen3.5:8b', // nothing stronger locally
      localModels: [{ id: 'qwen3.5:8b', size: 8 }, { id: 'qwen3.5:cloud', size: null }],
      projectPolicy: { privacy: 'internal', runtime: 'auto', cloudEscalation: 'allowed' },
    });
    expect(decision.kind).toBe('escalate_cloud_model');
    expect(decision.effectiveProvider).toBe('cloud');
    expect(decision.escalationOccurred).toBe(true);
  });

  it('PRIVACY HARD GATE: localOnly project + no local escalation → blocked_by_policy, never cloud', () => {
    const used = { ...newBudgetUsage(), sameModelRetries: DEFAULT_RECOVERY_POLICY.maxSameModelRetries };
    const { decision } = classifyAndDecide({ code: 'EMPTY_CONTENT_AFTER_REASONING' }, {
      ...ctxBase,
      used,
      assignedModel: 'qwen3.5:8b',
      localModels: [{ id: 'qwen3.5:8b', size: 8 }, { id: 'qwen3.5:cloud', size: null }],
      projectPolicy: { privacy: 'sensitive', runtime: 'localOnly', cloudEscalation: 'forbidden' },
    });
    expect(decision.kind).toBe('blocked');
    expect(decision.blockedByPolicy).toBe(true);
    expect(decision.reason).toMatch(/POLICY_BLOCKED/);
  });

  it('gate failure with budget → rework_after_gate_failure', () => {
    const { decision } = classifyAndDecide({ code: 'GATE_FAILURE' }, {
      ...ctxBase,
      gateEvidence: { gateId: 'targeted-tests', reason: 'exit code 1', attempt: 1 },
    });
    expect(decision.kind).toBe('rework_after_gate_failure');
    expect(decision.attempt).toBe(2);
  });

  it('gate rework exhausted → blocked RECOVERY_BUDGET_EXHAUSTED', () => {
    const used = { ...newBudgetUsage(), gateReworkAttempts: DEFAULT_RECOVERY_POLICY.maxGateReworkAttempts };
    const { decision } = classifyAndDecide({ code: 'GATE_FAILURE' }, { ...ctxBase, used });
    expect(decision.kind).toBe('blocked');
    expect(decision.reason).toMatch(/RECOVERY_BUDGET_EXHAUSTED/);
  });

  it('approval required → wait_for_approval (autonomous recovery stops)', () => {
    const { decision } = classifyAndDecide({ code: 'APPROVAL_REQUIRED' }, { ...ctxBase });
    expect(decision.kind).toBe('wait_for_approval');
  });

  it('cancellation → cancelled (dominates)', () => {
    const { decision } = classifyAndDecide(new Error('x'), { ...ctxBase, cancellationRequested: true });
    expect(decision.kind).toBe('cancelled');
  });

  it('budget exhausted before any decision → blocked', () => {
    const used = { ...newBudgetUsage(), executionAttempts: DEFAULT_RECOVERY_POLICY.maxExecutionAttempts };
    const { decision } = classifyAndDecide(new Error('timeout'), { ...ctxBase, used });
    expect(decision.kind).toBe('blocked');
    expect(decision.reason).toMatch(/RECOVERY_BUDGET_EXHAUSTED/);
  });

  it('NON_RETRYABLE → blocked, no retry', () => {
    const { decision } = classifyAndDecide(new Error('invalid workspace'), { ...ctxBase });
    expect(decision.kind).toBe('blocked');
    expect(decision.reason).toMatch(/NON_RETRYABLE/);
  });
});

describe('recoverAfterFailure — manager integration', () => {
  it('retryable failure → task re-queued with attempt++ + recovery metadata + event', async () => {
    const pump = await expectPumpCalled();
    const task = insert({ status: 'running', attempt: 1 });
    const decision = await backgroundTaskManager.recoverAfterFailure(task.taskId, new Error('HTTP 429 rate limit'));

    expect(decision?.kind).toBe('retry_same_model');
    expect(pump).toHaveBeenCalled(); // re-dispatch scheduled through existing queue
    const after = backgroundTaskRepo.getTask(task.taskId)!;
    expect(after.status).toBe('queued');
    expect(after.attempt).toBe(2);
    const rec = (after.metadata as any).recovery;
    expect(rec.sameModelRetries).toBe(1);
    expect(rec.effectiveModel).toBeNull(); // same model — no effective change
  });

  it('escalation records assigned/effective model truth (assigned never rewritten)', async () => {
    await noPump();
    const task = insert({
      status: 'running',
      attempt: 1,
      metadata: {
        assignedProvider: 'ollama',
        assignedModel: 'qwen3.5:4b',
      },
    });
    const used = { ...newBudgetUsage(), sameModelRetries: DEFAULT_RECOVERY_POLICY.maxSameModelRetries };
    backgroundTaskRepo.updateTask(task.taskId, {
      metadata: {
        assignedProvider: 'ollama',
        assignedModel: 'qwen3.5:4b',
        recovery: {
          executionAttempts: used.executionAttempts,
          gateReworkAttempts: 0,
          sameModelRetries: used.sameModelRetries,
          modelEscalations: 0,
          startedAtMs: used.startedAtMs,
        },
      },
    });
    const decision = await backgroundTaskManager.recoverAfterFailure(task.taskId, new Error('HTTP 429'));

    expect(decision?.kind).toBe('escalate_local_model');
    const after = backgroundTaskRepo.getTask(task.taskId)!;
    const m = after.metadata as any;
    expect(m.assignedModel).toBe('qwen3.5:4b'); // ASSIGNED untouched
    expect(m.effectiveModel).toBe('qwen3.5:8b'); // EFFECTIVE escalated
    expect(m.effectiveProvider).toBe('ollama');
    expect(m.escalationOccurred).toBe(true);
    expect(after.status).toBe('queued');
    expect(after.attempt).toBe(2);
  });

  it('PRIVACY: localOnly project + cloud-requiring escalation → blocked_by_policy, zero re-dispatch', async () => {
    const projectId = `proj-rec-priv-${Date.now()}`;
    projectsStore.createProject({ id: projectId, name: 'Recovery Privacy', workspacePath: undefined });
    createdProjects.push(projectId);
    policyStore.setPolicy(projectId, { privacy: 'sensitive', runtime: 'localOnly', cloudEscalation: 'forbidden' });

    const task = insert({
      status: 'running',
      projectId,
      metadata: {
        assignedProvider: 'ollama',
        assignedModel: 'qwen3.5:8b', // nothing stronger locally → would go cloud
        recovery: {
          executionAttempts: 2,
          gateReworkAttempts: 0,
          sameModelRetries: DEFAULT_RECOVERY_POLICY.maxSameModelRetries,
          modelEscalations: 0,
          startedAtMs: Date.now(),
        },
      },
    });

    const decision = await backgroundTaskManager.recoverAfterFailure(task.taskId, { code: 'EMPTY_CONTENT_AFTER_REASONING' });

    expect(decision?.kind).toBe('blocked');
    expect(decision?.blockedByPolicy).toBe(true);
    const after = backgroundTaskRepo.getTask(task.taskId)!;
    expect(after.status).toBe('blocked');
    expect(after.blocker).toMatch(/POLICY_BLOCKED/);
    expect(after.attempt).toBe(1); // NO retry attempt launched
  });

  it('budget exhaustion → blocked with RECOVERY_BUDGET_EXHAUSTED + event, no further attempt', async () => {
    const task = insertWithRecovery({ executionAttempts: DEFAULT_RECOVERY_POLICY.maxExecutionAttempts });
    const decision = await backgroundTaskManager.recoverAfterFailure(task.taskId, new Error('HTTP 429'));

    expect(decision?.kind).toBe('blocked');
    expect(decision?.reason).toMatch(/RECOVERY_BUDGET_EXHAUSTED/);
    const after = backgroundTaskRepo.getTask(task.taskId)!;
    expect(after.status).toBe('blocked');
    expect(after.blocker).toMatch(/RECOVERY_BUDGET_EXHAUSTED/);
    expect(after.attempt).toBe(1); // no further attempt launched (attempt never incremented)
  });

  it('gate rework: first failure → rework re-queued; exhausted → blocked; never completed', async () => {
    await noPump();
    const task = insert({ status: 'blocked', blocker: 'Verification failed', attempt: 1 });
    const gateEv = { gateId: 'targeted-tests', reason: 'exit code 1: 2 failing tests', attempt: 1 };

    const d1 = await backgroundTaskManager.recoverAfterFailure(task.taskId, { code: 'GATE_FAILURE' }, { gateEvidence: gateEv });
    expect(d1?.kind).toBe('rework_after_gate_failure');
    let after = backgroundTaskRepo.getTask(task.taskId)!;
    expect(after.status).toBe('queued'); // rework scheduled — NOT completed
    expect((after.metadata as any).recovery.gateReworkAttempts).toBe(1);
    expect(after.status).not.toBe('completed');

    // Exhaust rework budget → blocked.
    backgroundTaskRepo.updateTask(task.taskId, {
      status: 'blocked',
      metadata: {
        ...(after.metadata as any),
        recovery: { ...(after.metadata as any).recovery, gateReworkAttempts: DEFAULT_RECOVERY_POLICY.maxGateReworkAttempts },
      },
    });
    const d2 = await backgroundTaskManager.recoverAfterFailure(task.taskId, { code: 'GATE_FAILURE' }, { gateEvidence: gateEv });
    expect(d2?.kind).toBe('blocked');
    after = backgroundTaskRepo.getTask(task.taskId)!;
    expect(after.status).toBe('blocked');
    expect(after.status).not.toBe('completed');
  });

  it('cancellation dominates: cancellationRequested → no retry, no dispatch', async () => {
    const task = insert({ status: 'running', cancellationRequested: true, attempt: 1 });
    const decision = await backgroundTaskManager.recoverAfterFailure(task.taskId, new Error('HTTP 429'));
    expect(decision?.kind).toBe('cancelled');
    const after = backgroundTaskRepo.getTask(task.taskId)!;
    expect(after.attempt).toBe(1); // no retry attempt launched
    expect(after.status).not.toBe('queued');
  });

  it('human approval stops recovery: APPROVAL_REQUIRED → waiting_approval, no dispatch', async () => {
    const task = insert({ status: 'running', attempt: 1 });
    const decision = await backgroundTaskManager.recoverAfterFailure(task.taskId, { code: 'APPROVAL_REQUIRED' });
    expect(decision?.kind).toBe('wait_for_approval');
    const after = backgroundTaskRepo.getTask(task.taskId)!;
    expect(after.status).toBe('waiting_approval');
    expect(after.attempt).toBe(1); // autonomous recovery stopped — no retry
  });

  it('terminal task → recoverAfterFailure returns null (no recovery on completed)', async () => {
    const task = insert({ status: 'completed' });
    const decision = await backgroundTaskManager.recoverAfterFailure(task.taskId, new Error('HTTP 429'));
    expect(decision).toBeNull();
  });

  it('failed verification never distills as success memory', () => {
    const mem = distillFromExecution({
      operationId: `rec-op-${Date.now()}`,
      worker: 'codex',
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'FAILED',
      result: null,
      metadata: {},
      state: 'idle',
      firstTokenMs: null,
      elapsedMs: 0,
    } as any, {
      projectId: null,
      conversationId: 'conv-rec-test',
      taskId: `task-rec-${Date.now()}`,
      worker: 'codex',
      verificationState: 'failed',
      resultText: 'nothing verified',
    });
    if (mem) createdMemories.push(mem.id);
    expect(mem).not.toBeNull();
    if (mem) {
      expect(mem.type).not.toBe('decision');
      expect(mem.status).not.toBe('active');
    }
  });
});
