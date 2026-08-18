/**
 * RunLedger + GateRunner v1 tests (P26):
 * - RunLedger normalization + parent/child + last-run queries
 * - gate pass / fail / required-blocks / optional-does-not-block
 * - retry limit, cancellation, human approval pending + approval
 * - evidence persistence, artifact linking, no false completion
 * - memory distillation respects verification state
 */
import { describe, it, expect, afterEach } from 'vitest';
import { backgroundTaskRepo, ensureBackgroundTaskTables } from '../services/backgroundTasks/store.js';
import type { BackgroundTaskRecord } from '../services/backgroundTasks/types.js';
import { runTaskGates, parseGateConfigs, aggregateGateResult, runGateWithRetry } from '../services/gates/gateRunner.js';
import { runLedger } from '../services/runLedger.js';
import { distillFromExecution } from '../services/memory/distill.js';
import { memoryStore } from '../services/memory/store.js';
import { fileExistsGate, jsonSchemaGate, humanApprovalGate } from '../services/gates/registry.js';
import type { ExecutionRecord } from '../services/executionState.js';

const GATED = 'task-gated-test';
const SIMPLE = 'task-simple-test';
const createdTasks: string[] = [];
const createdMemories: string[] = [];

function makeTask(over: Partial<BackgroundTaskRecord> = {}): BackgroundTaskRecord {
  const base: BackgroundTaskRecord = {
    taskId: `task-${Date.now()}-${Math.floor(Math.random() * 1e4)}`,
    title: 'Gate test task',
    objective: 'Verify the gate runner.',
    originalRequest: 'Verify the gate runner.',
    route: 'direct',
    selectedAgent: 'CodeX',
    status: 'running',
    priority: 'medium',
    projectId: 'proj-gate-test',
    createdAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
    conversationId: 'conv-gate-test',
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
    cancellationRequested: false,
    resumable: false,
    resultText: null,
    attempt: 1,
    metadata: {},
    workspaceRoot: process.cwd(),
    ...over,
  };
  createdTasks.push(base.taskId);
  return base;
}

afterEach(() => {
  for (const id of createdTasks.splice(0)) {
    try { backgroundTaskRepo.updateTask(id, { status: 'cancelled' }); } catch { /* ignore */ }
  }
  for (const id of createdMemories.splice(0)) {
    try { memoryStore.remove(id); } catch { /* ignore */ }
  }
});

describe('P2/P3 — RunLedger normalization', () => {
  it('builds a normalized entry from a task + exposes parent/children', () => {
    ensureBackgroundTaskTables();
    const stamp = Date.now();
    const parent = makeTask({ taskId: `task-ledger-parent-${stamp}`, linkedRunId: `goal-parent-${stamp}`, status: 'completed', completedAt: new Date().toISOString(), verificationState: 'passed' });
    backgroundTaskRepo.insertTask(parent);
    const child = makeTask({ taskId: `task-ledger-child-${stamp}`, linkedRunId: `goal-child-${stamp}`, parentTaskId: parent.taskId, status: 'running' });
    backgroundTaskRepo.insertTask(child);

    const entry = runLedger.getRun(`goal-child-${stamp}`);
    expect(entry).not.toBeNull();
    expect(entry!.taskId).toBe(child.taskId);
    expect(entry!.parentTaskId).toBe(parent.taskId);
    expect(entry!.workerType).toBe('codex');
    expect(entry!.projectId).toBe('proj-gate-test');

    const parentEntry = runLedger.getParent(child.taskId);
    expect(parentEntry?.taskId).toBe(parent.taskId);

    const kids = runLedger.getChildren(parent.taskId);
    expect(kids.map((k) => k.taskId)).toContain(child.taskId);

    const lastCompleted = runLedger.getLastCompletedRun('proj-gate-test');
    expect(lastCompleted?.taskId).toBe(parent.taskId);
  });

  it('normalizes event kinds into the run vocabulary', async () => {
    const { normalizeEventKind } = await import('../services/runLedger.js');
    expect(normalizeEventKind('task.queued')).toBe('run.created');
    expect(normalizeEventKind('task.verified')).toBe('run.verification.passed');
    expect(normalizeEventKind('task.gate_failed')).toBe('run.gate.failed');
    expect(normalizeEventKind('task.completed')).toBe('run.completed');
  });
});

describe('P6 — required gates block completion', () => {
  it('a failing required gate leaves the task NOT completed', async () => {
    ensureBackgroundTaskTables();
    const task = makeTask({
      status: 'running',
      metadata: {
        gates: [{ type: 'command', id: 'targeted-tests', command: 'node --test gate-runner-nonexistent.js', required: true }],
      },
    });
    backgroundTaskRepo.insertTask(task);
    const set = await runTaskGates(task.taskId);
    expect(set.allRequiredPassed).toBe(false);
    expect(set.anyFailed).toBe(true);
    const after = backgroundTaskRepo.getTask(task.taskId)!;
    expect(after.status).not.toBe('completed');
    expect(after.verificationState).toBe('failed');
    expect(after.blocker).toMatch(/Verification failed/);
    // evidence persisted
    const gateResults = (after.metadata as any).gateResults as any[];
    expect(gateResults.length).toBeGreaterThanOrEqual(1);
    expect(gateResults[0].gateId).toBe('targeted-tests');
    expect(gateResults[0].status).toBe('failed');
    expect(gateResults[0].exitCode).not.toBe(0);
  }, 30_000);
});

describe('P7/P26 — gate types', () => {
  it('file-exists gate passes on a real file, fails on a missing one', async () => {
    const ctx = { runId: 'r1', workspacePath: process.cwd(), config: {} };
    const ok = await fileExistsGate({ id: 'fixture', type: 'file-exists', path: 'package.json' }).run(ctx as any);
    expect(ok.passed).toBe(true);
    const missing = await fileExistsGate({ id: 'missing', type: 'file-exists', path: 'definitely-not-here-xyz.json' }).run(ctx as any);
    expect(missing.passed).toBe(false);
  });

  it('json-schema gate validates required fields', async () => {
    const ctx = { runId: 'r1', workspacePath: process.cwd(), config: {} };
    const ok = await jsonSchemaGate({ id: 'schema', type: 'json-schema', path: 'package.json', schema: { requiredFields: ['name', 'version'] } }).run(ctx as any);
    expect(ok.passed).toBe(true);
    const bad = await jsonSchemaGate({ id: 'schema2', type: 'json-schema', path: 'package.json', schema: { requiredFields: ['name', 'definitely-not-a-field'] } }).run(ctx as any);
    expect(bad.passed).toBe(false);
  });

  it('human-approval gate stays pending without approval and passes with it', async () => {
    const gate = humanApprovalGate({ id: 'human', type: 'human-approval', required: true, reason: 'Review the change.' });
    const pending = await gate.run({ runId: 'r1', config: {} } as any);
    expect(pending.status).toBe('pending');
    expect(pending.passed).toBe(false);
    const approved = await gate.run({ runId: 'r1', config: { approved: true } } as any);
    expect(approved.status).toBe('passed');
    expect(approved.passed).toBe(true);
  });
});

describe('P23 — retry limit', () => {
  it('retries up to maxRetries and no more', async () => {
    const cfg = { id: 'flaky', type: 'command' as const, command: 'node --test gate-runner-nonexistent.js', required: true, retryOnFail: true, maxRetries: 2 };
    const ctx = { runId: 'r1', workspacePath: process.cwd(), signal: undefined, config: {} };
    const attempts = await runGateWithRetry(cfg, ctx as any);
    expect(attempts.length).toBe(3); // initial + 2 retries
    const agg = aggregateGateResult('flaky', attempts);
    expect(agg.status).toBe('failed');
    expect(agg.attempt).toBe(3);
  }, 30_000);
});

describe('P15 — cancellation', () => {
  it('an aborted signal stops gate execution without completion', async () => {
    ensureBackgroundTaskTables();
    const task = makeTask({
      status: 'running',
      metadata: { gates: [{ type: 'command', id: 'slow', command: 'node --test gate-runner-nonexistent.js', required: true }] },
    });
    backgroundTaskRepo.insertTask(task);
    const ac = new AbortController();
    ac.abort();
    const set = await runTaskGates(task.taskId, { signal: ac.signal });
    const after = backgroundTaskRepo.getTask(task.taskId)!;
    expect(after.status).not.toBe('completed');
    expect(set.allRequiredPassed).toBe(false);
  });
});

describe('P20 — human approval blocks completion', () => {
  it('a required pending human gate leaves the task blocked/verifying, not completed', async () => {
    ensureBackgroundTaskTables();
    const task = makeTask({
      status: 'running',
      metadata: { gates: [{ type: 'human-approval', id: 'human-review', required: true, reason: 'Review the change.' }] },
    });
    backgroundTaskRepo.insertTask(task);
    const set = await runTaskGates(task.taskId);
    expect(set.allRequiredPassed).toBe(false);
    const after = backgroundTaskRepo.getTask(task.taskId)!;
    expect(after.status).not.toBe('completed');
    const gateResults = (after.metadata as any).gateResults as any[];
    expect(gateResults[0].status).toBe('pending');
  });

  it('explicit approval passes the gate and allows completion', async () => {
    ensureBackgroundTaskTables();
    const task = makeTask({
      status: 'running',
      metadata: { gates: [{ type: 'human-approval', id: 'human-review', required: true, reason: 'Review the change.' }] },
    });
    backgroundTaskRepo.insertTask(task);
    const set = await runTaskGates(task.taskId, { approveOverride: true });
    expect(set.allRequiredPassed).toBe(true);
    const gateResults = ((backgroundTaskRepo.getTask(task.taskId) as any).metadata as any).gateResults as any[];
    expect(gateResults[0].status).toBe('passed');
  });
});

describe('P13/P18 — artifact + model truth', () => {
  it('exposes files_changed as artifactIds and metadata models as model truth', () => {
    ensureBackgroundTaskTables();
    const stamp = Date.now();
    const task = makeTask({
      taskId: `task-artifacts-${stamp}`,
      filesChanged: ['src/a.ts', 'src/b.ts'],
      linkedRunId: 'goal-art',
      metadata: { assignedModel: 'qwen3.5:4b', effectiveModel: 'qwen3.5:cloud' },
    });
    backgroundTaskRepo.insertTask(task);
    const entry = runLedger.getTaskRun(task.taskId)!;
    expect(entry.artifactIds).toEqual(['src/a.ts', 'src/b.ts']);
    expect(entry.assignedModel).toBe('qwen3.5:4b');
    expect(entry.effectiveModel).toBe('qwen3.5:cloud');
  });
});

describe('P19 — memory distillation respects verification state', () => {
  const rec: ExecutionRecord = {
    operationId: 'op-verify-distill',
    worker: 'codex',
    status: 'COMPLETED',
    currentAction: null, requestedProvider: null, requestedModel: null,
    resolvedProvider: null, resolvedModel: null, fallbackUsed: false, fallbackReason: null,
    startedAt: Date.now(), endedAt: Date.now(), lastActivityAt: Date.now(),
    queuePosition: null, activeCount: null, limit: null, result: 'x', cancel: null,
    discoveredCount: null, qualifiedCount: null, rejectedCount: null, targetCount: null,
    note: null, workspace: null,
  };

  it('does NOT distill failed verification as a success milestone', () => {
    const ids = distillFromExecution(rec, {
      taskId: 'task-unverified', projectId: 'proj-gate-test',
      verificationState: 'failed',
      gateResults: [{ gateId: 'targeted-tests', status: 'failed', passed: false }],
    });
    createdMemories.push(...ids);
    expect(ids.length).toBeGreaterThanOrEqual(1);
    for (const id of ids) {
      const m = memoryStore.get(id)!;
      expect(m.type).toBe('episodic');
      expect(m.title).toMatch(/blocked by verification/i);
      expect(m.tags).toContain('blocker');
    }
  });

  it('distills passed verification as success with gate note', () => {
    const ids = distillFromExecution(rec, {
      taskId: 'task-verified', projectId: 'proj-gate-test',
      verificationState: 'passed',
      gateResults: [{ gateId: 'targeted-tests', status: 'passed', passed: true }],
    });
    createdMemories.push(...ids);
    const m = memoryStore.get(ids[0])!;
    expect(m.title).toMatch(/inspection completed/);
    expect(m.content).toMatch(/Verification: passed/);
  });

  it('does not distill pending/unknown verification as success', () => {
    const ids = distillFromExecution(rec, { taskId: 'task-pending', projectId: 'proj-gate-test', verificationState: 'pending' });
    createdMemories.push(...ids);
    expect(ids.length).toBe(0);
  });
});

describe('P8 — gate config parsing', () => {
  it('parses declarative requiredGates via gateDefinitions', () => {
    const task = makeTask({
      metadata: {
        requiredGates: ['targeted-tests'],
        gateDefinitions: {
          'targeted-tests': { type: 'command', id: 'targeted-tests', command: 'npm test -- projectMemory', required: true },
        },
      },
    });
    const parsed = parseGateConfigs(task);
    expect(parsed.hasRequired).toBe(true);
    expect(parsed.gates[0].id).toBe('targeted-tests');
  });
});
