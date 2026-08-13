/**
 * Recovery adapter wiring + model pinning tests (P19):
 * - CodeX recovery model override actually reaches createGoal executionOptions
 * - Hermes execution failure routes through recoverAfterFailure (real emitter)
 * - Hermes createRun receives the recovery-effective provider/model
 * - research failure routes through recoverAfterFailure (no fake support)
 * - team (codex-backed) failure routes through recoverAfterFailure
 * - policy rejects pinned cloud model at dispatch
 * - recovery metadata persistence (requested/effective truth)
 * - ACTIVE RUN recovery label + terminal clearing
 * - no duplicate recovery events
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { backgroundTaskRepo, ensureBackgroundTaskTables } from '../services/backgroundTasks/store.js';
import type { BackgroundTaskRecord } from '../services/backgroundTasks/types.js';
import { backgroundTaskManager } from '../services/backgroundTasks/manager.js';
import {
  dispatchCodexTask, dispatchHermesTask, dispatchResearchTask, dispatchTeamTask, resolveRecoveryPin,
} from '../services/backgroundTasks/adapters.js';
import * as adaptersModule from '../services/backgroundTasks/adapters.js';
import { codexService } from '../domains/codex/service.js';
import { hermesApiService } from '../services/hermesApiService.js';
import { goalStore } from '../services/goalStore.js';
import { coordinatorService } from '../domains/teams/coordinatorService.js';
import { TeamRunner } from '../services/agentTeams/teamRunner.js';
import * as researchBriefModule from '../workflows/researchBrief.js';
import { projectsStore } from '../services/projectsStore.js';
import { policyStore } from '../services/policy/policyStore.js';
import * as executionState from '../services/executionState.js';

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

function makeTask(over: Partial<BackgroundTaskRecord> = {}): BackgroundTaskRecord {
  const base: BackgroundTaskRecord = {
    taskId: `task-wire-${Date.now()}-${Math.floor(Math.random() * 1e4)}`,
    title: 'Wiring test task',
    objective: 'Test recovery wiring.',
    originalRequest: 'Test recovery wiring.',
    route: 'direct',
    selectedAgent: 'CodeX',
    status: 'running',
    priority: 'medium',
    projectId: null,
    createdAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
    conversationId: 'conv-wire',
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

beforeAll(() => { ensureBackgroundTaskTables(); });

beforeEach(() => { vi.restoreAllMocks(); });
afterEach(() => { vi.restoreAllMocks(); });

afterAll(() => {
  for (const id of createdTasks.splice(0)) {
    try { backgroundTaskRepo.updateTask(id, { status: 'cancelled' }); } catch { /* ignore */ }
  }
  for (const id of createdProjects.splice(0)) {
    try { projectsStore.deleteProject(id); } catch { /* ignore */ }
  }
});

const tick = () => new Promise((r) => setTimeout(r, 25));

describe('resolveRecoveryPin (policy revalidation)', () => {
  const allow = { allowEscalation: true, disableFallback: false };
  const forbid = { allowEscalation: false, disableFallback: true };

  it('no recovery metadata → no pin', () => {
    expect(resolveRecoveryPin(insert(), allow)).toEqual({});
  });

  it('local escalation → provider/model override', () => {
    const t = insert({ metadata: { recovery: { effectiveProvider: 'ollama', effectiveModel: 'qwen3.5:8b' } } });
    expect(resolveRecoveryPin(t, allow)).toEqual({ providerOverride: 'ollama', modelOverride: 'qwen3.5:8b' });
  });

  it('cloud marker allowed when policy permits escalation (no literal pin)', () => {
    const t = insert({ metadata: { recovery: { effectiveProvider: 'cloud', effectiveModel: 'cloud-escalation' } } });
    expect(resolveRecoveryPin(t, allow)).toEqual({});
  });

  it('POLICY: pinned cloud refused when escalation forbidden', () => {
    const t = insert({ metadata: { recovery: { effectiveProvider: 'cloud', effectiveModel: 'cloud-escalation' } } });
    const r = resolveRecoveryPin(t, forbid);
    expect('blockedReason' in r).toBe(true);
    if ('blockedReason' in r) expect(r.blockedReason).toMatch(/policy/);
  });

  it('local pin still allowed under localOnly (local escalation is never cloud)', () => {
    const t = insert({ metadata: { recovery: { effectiveProvider: 'ollama', effectiveModel: 'qwen3.5:8b' } } });
    expect(resolveRecoveryPin(t, forbid)).toEqual({ providerOverride: 'ollama', modelOverride: 'qwen3.5:8b' });
  });
});

describe('CodeX dispatch — model pinning reaches the goal', () => {
  it('recovery-effective model is passed into createGoal executionOptions', async () => {
    const createGoal = vi.spyOn(codexService, 'createGoal').mockResolvedValue('goal-pin-test' as any);
    const task = insert({
      worker: 'codex',
      metadata: {
        assignedProvider: 'ollama',
        assignedModel: 'qwen3.5:4b',
        recovery: { effectiveProvider: 'ollama', effectiveModel: 'qwen3.5:8b' },
      },
    });
    await dispatchCodexTask(task, 'C:\\work\\ws');

    expect(createGoal).toHaveBeenCalledTimes(1);
    const [, , , , , , options] = createGoal.mock.calls[0];
    expect(options).toMatchObject({
      providerOverride: 'ollama',
      modelOverride: 'qwen3.5:8b',
    });
    // ASSIGNED truth is never rewritten.
    const after = backgroundTaskRepo.getTask(task.taskId)!;
    expect((after.metadata as any).assignedModel).toBe('qwen3.5:4b');
  });

  it('POLICY: dispatch refuses a cloud pin under localOnly', async () => {
    const createGoal = vi.spyOn(codexService, 'createGoal').mockResolvedValue('goal-blocked' as any);
    const projectId = `proj-wire-priv-${Date.now()}`;
    projectsStore.createProject({ id: projectId, name: 'Wire Privacy', workspacePath: undefined });
    createdProjects.push(projectId);
    policyStore.setPolicy(projectId, { privacy: 'sensitive', runtime: 'localOnly', cloudEscalation: 'forbidden' });
    const task = insert({
      worker: 'codex',
      projectId,
      metadata: { recovery: { effectiveProvider: 'cloud', effectiveModel: 'cloud-escalation' } },
    });
    const res = await dispatchCodexTask(task, 'C:\\work\\ws');

    expect(res.ok).toBe(false);
    expect(createGoal).not.toHaveBeenCalled(); // never dispatched
    const after = backgroundTaskRepo.getTask(task.taskId)!;
    expect(after.status).toBe('blocked');
    expect(after.blocker).toMatch(/policy/);
  });
});

describe('Hermes wiring', () => {
  it('createRun receives the recovery-effective provider/model', async () => {
    const createRun = vi.spyOn(hermesApiService, 'createRun').mockResolvedValue({
      id: 'run-wire', hermesRunId: 'h-wire', status: 'queued',
    } as any);
    const task = insert({
      worker: 'hermes',
      metadata: { recovery: { effectiveProvider: 'ollama', effectiveModel: 'qwen3.5:8b' } },
    });
    await dispatchHermesTask(task, 'C:\\work\\ws');

    expect(createRun).toHaveBeenCalledTimes(1);
    const opts = createRun.mock.calls[0][0];
    expect(opts.provider).toBe('ollama');
    expect(opts.model).toBe('qwen3.5:8b');
  });

  it('Hermes execution failure routes through recoverAfterFailure (real emitter)', async () => {
    vi.spyOn(hermesApiService, 'createRun').mockResolvedValue({
      id: 'run-fail', hermesRunId: 'h-fail', status: 'queued',
    } as any);
    const task = insert({ worker: 'hermes', status: 'running', attempt: 1 });
    const dispatch = vi.spyOn(adaptersModule, 'dispatchTask').mockResolvedValue({ ok: true });
    await dispatchHermesTask(task, 'C:\\work\\ws');

    // Emit the upstream failure the way the SSE consumer would.
    hermesApiService.emit('hermes:update', { id: 'run-fail', status: 'failed', errorMessage: 'HTTP 429 rate limit' } as any);
    await tick();

    const after = backgroundTaskRepo.getTask(task.taskId)!;
    expect(after.status).toBe('queued'); // retry_same_model re-queued it
    expect(after.attempt).toBe(2);
    expect(dispatch).toHaveBeenCalled(); // recovery re-dispatched through the production dispatcher
  });
});

describe('Research wiring (no fake support)', () => {
  it('research failure → recoverAfterFailure → honest blocked (escalation unsupported)', async () => {
    vi.spyOn(researchBriefModule, 'executeResearchBriefWorkflow').mockRejectedValue(new Error('brief pipeline crashed'));
    const task = insert({ worker: 'research', status: 'running', attempt: 1 });
    await dispatchResearchTask(task);
    await tick();

    const after = backgroundTaskRepo.getTask(task.taskId)!;
    expect(after.status).toBe('blocked'); // NON_RETRYABLE — no fake escalation
    expect(after.blocker).toMatch(/NON_RETRYABLE/);
  });
});

describe('Team wiring (codex-backed)', () => {
  it('team goal failure routes through recoverAfterFailure', async () => {
    const goalId = `goal-wire-team-${Date.now()}`;
    goalStore.create({
      id: goalId, workspacePath: 'C:\\work\\ws', originalGoal: 'team test', status: 'running',
      history: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      retryCount: 0, providerFallbackCount: 0, executionOptions: {},
    } as any);
    vi.spyOn(coordinatorService, 'createTeam').mockResolvedValue({ teamId: 'team-wire' } as any);
    vi.spyOn(TeamRunner, 'startTeam').mockResolvedValue(goalId as any);
    vi.spyOn(backgroundTaskManager, 'pumpQueuedForWorker').mockResolvedValue(undefined as any);
    const task = insert({ worker: 'team', status: 'running', attempt: 1 });
    await dispatchTeamTask(task, 'C:\\work\\ws');

    goalStore.update(goalId, { status: 'failed', lastError: 'team goal crashed' });
    await tick();

    const after = backgroundTaskRepo.getTask(task.taskId)!;
    expect(after.status).toBe('blocked'); // NON_RETRYABLE → honest blocked
    expect(after.blocker).toMatch(/NON_RETRYABLE/);
  });
});

describe('Recovery metadata persistence + event truth', () => {
  it('recovery metadata persists requested/effective fields on the task record', async () => {
    const task = insert({
      status: 'running',
      metadata: {
        assignedProvider: 'ollama',
        assignedModel: 'qwen3.5:4b',
        recovery: {
          executionAttempts: 2,
          gateReworkAttempts: 0,
          sameModelRetries: 2,
          modelEscalations: 0,
          startedAtMs: Date.now(),
        },
      },
    });
    vi.spyOn(backgroundTaskManager, 'pumpQueuedForWorker').mockResolvedValue(undefined as any);
    const decision = await backgroundTaskManager.recoverAfterFailure(task.taskId, new Error('HTTP 429'));
    expect(decision?.kind).toBe('escalate_local_model');

    // Read back from the DB — persistence, not in-memory.
    const after = backgroundTaskRepo.getTask(task.taskId)!;
    const rec = (after.metadata as any).recovery;
    expect(rec.requestedProvider).toBe('ollama');
    expect(rec.requestedModel).toBe('qwen3.5:8b');
    expect(rec.effectiveProvider).toBe('ollama');
    expect(rec.effectiveModel).toBe('qwen3.5:8b');
    expect(rec.escalationOccurred).toBe(true);
    expect(rec.escalationReason).toBeTruthy();
    expect(rec.executionAttempts).toBe(3);
    // ASSIGNED untouched.
    expect((after.metadata as any).assignedModel).toBe('qwen3.5:4b');
  });

  it('one recovery decision → exactly one retry event (no duplicates)', async () => {
    const task = insert({ status: 'running', attempt: 1 });
    vi.spyOn(backgroundTaskManager, 'pumpQueuedForWorker').mockResolvedValue(undefined as any);
    await backgroundTaskManager.recoverAfterFailure(task.taskId, new Error('HTTP 429'));

    const events = backgroundTaskRepo.getEvents(task.taskId) as any[];
    const retries = events.filter((e) => e.kind === 'run.recovery.retry');
    expect(retries).toHaveLength(1);
    const starts = events.filter((e) => e.kind === 'run.recovery.started');
    expect(starts).toHaveLength(1);
  });
});

describe('ACTIVE RUN truth', () => {
  it('recovery label flows into the execution record', async () => {
    const task = insert({ status: 'running', attempt: 1, conversationId: 'conv-active' });
    const opId = `op-active-${Date.now()}`;
    backgroundTaskRepo.updateTask(task.taskId, { metadata: { operationId: opId } });
    executionState.begin({ operationId: opId, worker: 'codex' });
    vi.spyOn(backgroundTaskManager, 'pumpQueuedForWorker').mockResolvedValue(undefined as any);

    await backgroundTaskManager.recoverAfterFailure(task.taskId, new Error('HTTP 429'));

    const rec = executionState.get(opId);
    expect(rec?.currentAction).toContain('Retrying local model');
  });

  it('blocked recovery clears the ACTIVE RUN record', async () => {
    const task = insert({
      status: 'running',
      conversationId: 'conv-clear',
      metadata: {
        operationId: 'op-clear',
        recovery: { executionAttempts: 3, gateReworkAttempts: 0, sameModelRetries: 0, modelEscalations: 0, startedAtMs: Date.now() },
      },
    });
    executionState.begin({ operationId: 'op-clear', worker: 'codex' });
    await backgroundTaskManager.recoverAfterFailure(task.taskId, new Error('HTTP 429'));

    const rec = executionState.get('op-clear');
    expect(rec?.status).toBe('FAILED');
    expect(executionState.snapshot()?.operationId).not.toBe('op-clear'); // not current
  });

  it('completed transition clears the ACTIVE RUN record', async () => {
    const task = insert({ status: 'running', conversationId: 'conv-done', metadata: { operationId: 'op-done' } });
    executionState.begin({ operationId: 'op-done', worker: 'codex' });
    backgroundTaskManager.transition(task.taskId, 'running', {});
    backgroundTaskManager.verifyCompletion(task.taskId, {
      resultText: 'done', buildState: 'passed', testState: 'passed', verificationNote: 'verified',
    });

    const rec = executionState.get('op-done');
    expect(rec?.status).toBe('COMPLETED');
    expect(executionState.snapshot()?.operationId).not.toBe('op-done');
  });

  it('cancelled transition clears the ACTIVE RUN record', async () => {
    const task = insert({ status: 'running', conversationId: 'conv-cancelled', metadata: { operationId: 'op-cancelled' } });
    executionState.begin({ operationId: 'op-cancelled', worker: 'codex' });
    backgroundTaskManager.transition(task.taskId, 'cancelled', { blocker: 'Stopped by user' });

    const rec = executionState.get('op-cancelled');
    expect(rec?.status).toBe('CANCELLED');
    expect(executionState.snapshot()?.operationId).not.toBe('op-cancelled');
  });
});
