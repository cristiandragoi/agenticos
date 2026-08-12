/**
 * GateRunner v1 — executes a task's declared gate set and enforces the
 * completion rule: a task with required gates must NOT become 'completed'
 * until every required gate passed. Evidence is persisted per gate into the
 * task metadata + task events; cancellation is respected between gates.
 *
 * Lifecycle: EXECUTION FINISHES → VERIFYING → RUN GATES → PASS → completed /
 * FAIL → blocked (retryable) or failed (maxRetries exceeded / not retryable).
 */
import { backgroundTaskRepo, ensureBackgroundTaskTables } from '../backgroundTasks/store.js';
import { TERMINAL_STATUSES } from '../backgroundTasks/types.js';
import type { BackgroundTaskRecord } from '../backgroundTasks/types.js';
import { buildGateFromConfig } from './registry.js';
import type { GateConfig, GateContext, GateResult, GateSetResult } from './types.js';

export interface ParsedGateSet {
  gates: GateConfig[];
  hasRequired: boolean;
}

/** Parse the task's declared gate config from metadata (P8). */
export function parseGateConfigs(task: BackgroundTaskRecord | null | undefined): ParsedGateSet {
  if (!task) return { gates: [], hasRequired: false };
  const meta = task.metadata || {};
  const gates: GateConfig[] = Array.isArray(meta.gates) ? (meta.gates as GateConfig[]) : [];
  // Legacy/declarative form: requiredGates: ["build", "targeted-tests"] maps
  // to known gate definitions when provided in metadata.gateDefinitions.
  const requiredNames: string[] = Array.isArray(meta.requiredGates) ? (meta.requiredGates as string[]) : [];
  const defs: Record<string, GateConfig> = (meta.gateDefinitions as Record<string, GateConfig>) || {};
  for (const name of requiredNames) {
    if (!gates.some((g) => g.id === name) && defs[name]) gates.push(defs[name]);
  }
  const withDefaults = gates.map((g) => ({ required: g.required !== false, ...g }));
  return { gates: withDefaults, hasRequired: withDefaults.some((g) => g.required) };
}

/** Run a single gate with retry policy. Cancellation aborts between attempts. */
export async function runGateWithRetry(
  cfg: GateConfig,
  ctx: Omit<GateContext, 'config'> & { config?: Record<string, unknown> },
): Promise<GateResult[]> {
  const gate = buildGateFromConfig(cfg);
  const maxRetries = cfg.retryOnFail ? (cfg.maxRetries ?? 1) : 0;
  const attempts: GateResult[] = [];
  const runCtx = { ...ctx, config: { ...(ctx.config || {}), gateConfig: cfg } };
  for (let i = 0; i <= maxRetries; i++) {
    if (ctx.signal?.aborted) {
      attempts.push({ gateId: cfg.id, passed: false, status: 'failed', reason: 'Cancelled during verification.', attempt: i + 1, startedAt: new Date().toISOString(), completedAt: new Date().toISOString() });
      break;
    }
    const result = await gate.run(runCtx);
    attempts.push({ ...result, attempt: i + 1 });
    if (result.status !== 'failed') break; // passed/pending stop the retry loop
  }
  return attempts;
}

/** Aggregate attempts into the canonical result row for persistence. */
export function aggregateGateResult(gateId: string, attempts: GateResult[]): GateResult {
  const last = attempts[attempts.length - 1];
  return {
    gateId,
    passed: last.passed,
    status: last.status,
    reason: attempts.length > 1 ? `${attempts.length} attempt(s): ${attempts.map((a) => `${a.status} (${a.attempt})`).join(' → ')} — ${last.reason}` : last.reason,
    evidence: last.evidence,
    exitCode: last.exitCode,
    command: last.command,
    logPath: last.logPath,
    attempt: attempts.length,
    startedAt: attempts[0]?.startedAt || last.startedAt,
    completedAt: last.completedAt,
  };
}

// ── P20 — explicit human approval resolution ───────────────────────────────

/**
 * Record an explicit human approval for a pending human-approval gate and,
 * if every required gate is now passed, complete the task. Nothing here
 * auto-passes: the approval must come through this endpoint (a human action),
 * never from the worker or the model.
 */
export async function approveGate(taskId: string, gateId: string): Promise<{ ok: boolean; completed: boolean; reason?: string }> {
  ensureBackgroundTaskTables();
  const { backgroundTaskManager } = await import('../backgroundTasks/manager.js');
  const task = backgroundTaskRepo.getTask(taskId);
  if (!task) return { ok: false, completed: false, reason: 'Task not found.' };
  const { gates, hasRequired } = parseGateConfigs(task);
  const cfg = gates.find((g) => g.id === gateId);
  if (!cfg) return { ok: false, completed: false, reason: `Gate ${gateId} is not declared on this task.` };
  if (cfg.type !== 'human-approval') return { ok: false, completed: false, reason: `Gate ${gateId} is not a human-approval gate.` };

  const meta = (task.metadata || {}) as Record<string, any>;
  const existing: GateResult[] = Array.isArray(meta.gateResults) ? (meta.gateResults as GateResult[]) : [];
  const prev = existing.find((r) => r.gateId === gateId);
  if (prev && prev.status === 'passed') return { ok: true, completed: false, reason: 'Gate already approved.' };

  const { buildGateFromConfig } = await import('./registry.js');
  const gate = buildGateFromConfig(cfg);
  const result = await gate.run({
    runId: task.linkedRunId || task.taskId,
    taskId,
    projectId: task.projectId ?? undefined,
    workspacePath: task.workspaceRoot || undefined,
    config: { approved: true },
  });
  const updatedResults = [...existing.filter((r) => r.gateId !== gateId), result];
  const approvedGates: string[] = Array.isArray(meta.approvedGates) ? [...(meta.approvedGates as string[]), gateId] : [gateId];
  backgroundTaskRepo.updateTask(taskId, { metadata: { ...meta, gateResults: updatedResults, approvedGates } });
  backgroundTaskManager.appendEvent(taskId, 'task.gate_passed', `Human approval recorded for ${gateId}.`, { gateId, approved: true });

  // Completion only when every required gate has now passed.
  const required = gates.filter((g) => g.required !== false);
  const allPassed = required.length > 0 && required.every((g) => updatedResults.find((r) => r.gateId === g.id)?.status === 'passed');
  if (hasRequired && allPassed) {
    const passedIds = updatedResults.filter((r) => r.status === 'passed').map((r) => r.gateId).join(', ');
    backgroundTaskManager.verifyCompletion(taskId, {
      resultText: task.resultText || `Approved by human (${gateId}).`,
      readOnly: false,
      verificationNote: `Completed and verified after human approval: ${passedIds}.`,
    });
    return { ok: true, completed: true };
  }
  return { ok: true, completed: false, reason: 'Approval recorded; other required gates still pending.' };
}

/**
 * Run a task's full gate set.
 * - persists every gate result into task.metadata.gateResults + task events
 * - moves the task to 'verifying' while gates run
 * - does NOT complete the task itself: returns allRequiredPassed so the
 *   caller (worker adapter) can verifyCompletion (P6).
 * - on a required-gate failure transitions the task to 'blocked' (retryable)
 *   or 'failed' (not retryable / maxRetries exceeded) with verificationState
 *   failed — never completed.
 */
export async function runTaskGates(
  taskId: string,
  opts: { allowedCommands?: string[]; signal?: AbortSignal; approveOverride?: boolean } = {},
): Promise<GateSetResult> {
  ensureBackgroundTaskTables();
  const { backgroundTaskManager } = await import('../backgroundTasks/manager.js');
  const task = backgroundTaskRepo.getTask(taskId);
  if (!task) throw new Error(`runTaskGates: task ${taskId} not found.`);
  if (TERMINAL_STATUSES.has(task.status)) {
    throw new Error(`runTaskGates: task ${taskId} is already terminal (${task.status}).`);
  }
  const { gates, hasRequired } = parseGateConfigs(task);
  const startedAt = new Date().toISOString();
  const results: GateResult[] = [];

  if (!hasRequired) {
    // No required gates — nothing blocks completion; report an empty set.
    return { runId: task.linkedRunId || task.taskId, taskId, results, allRequiredPassed: true, anyFailed: false, startedAt, completedAt: new Date().toISOString() };
  }

  backgroundTaskManager.transition(taskId, 'verifying', { currentStage: 'verifying', progressMessage: 'Running required gates…' });

  const ctx = {
    runId: task.linkedRunId || task.taskId,
    taskId,
    projectId: task.projectId ?? undefined,
    workspacePath: task.workspaceRoot || undefined,
    artifacts: Array.isArray(task.filesChanged) ? task.filesChanged : [],
    allowedCommands: opts.allowedCommands,
    signal: opts.signal,
    config: { approveOverride: opts.approveOverride === true, task },
  };

  for (const cfg of gates) {
    if (opts.signal?.aborted) break;
    // P20 — explicit human approval: gates listed in metadata.approvedGates
    // (written by the approval resolver, never by the worker/model) run with
    // config.approved = true. Nothing auto-passes this.
    const approvedGates: string[] = Array.isArray((task.metadata as Record<string, any>)?.approvedGates)
      ? ((task.metadata as Record<string, any>).approvedGates as string[])
      : [];
    const approved = approvedGates.includes(cfg.id);
    backgroundTaskManager.appendEvent(taskId, 'task.gate_started', `Gate ${cfg.id} started.${approved ? ' (human-approved)' : ''}`, { gateId: cfg.id, type: cfg.type, approved });
    const live = backgroundTaskRepo.getTask(taskId);
    if (live && !TERMINAL_STATUSES.has(live.status)) {
      backgroundTaskRepo.updateTask(taskId, { progressMessage: `Verifying: gate ${cfg.id}`, currentStage: 'verifying' });
    }
    const attempts = await runGateWithRetry(cfg, { ...ctx, config: { ...(ctx.config || {}), approved } });
    const aggregated = aggregateGateResult(cfg.id, attempts);
    results.push(aggregated);
    backgroundTaskManager.appendEvent(taskId, aggregated.passed ? 'task.gate_passed' : 'task.gate_failed',
      `Gate ${cfg.id} ${aggregated.passed ? 'passed' : aggregated.status === 'pending' ? 'pending approval' : 'failed'}: ${aggregated.reason.slice(0, 180)}`,
      { gateId: cfg.id, status: aggregated.status, attempt: aggregated.attempt, exitCode: aggregated.exitCode ?? null });
  }

  // Persist results.
  const current = backgroundTaskRepo.getTask(taskId);
  if (current && !TERMINAL_STATUSES.has(current.status)) {
    backgroundTaskRepo.updateTask(taskId, {
      metadata: { ...(current.metadata || {}), gateResults: results },
      buildState: results.some((r) => r.gateId === 'server-build' && r.passed) ? 'passed' : current.buildState,
      testState: results.some((r) => r.gateId.includes('test') && r.passed) ? 'passed' : current.testState,
    });
  }

  const required = results.filter((r) => gates.find((g) => g.id === r.gateId)?.required !== false);
  const requiredFailed = required.filter((r) => r.status === 'failed');
  const requiredPending = required.filter((r) => r.status === 'pending');
  const anyFailed = results.some((r) => r.status === 'failed');
  const aborted = Boolean(opts.signal?.aborted);
  // Cancellation mid-verification must never report allRequiredPassed.
  const allRequiredPassed = !aborted && requiredFailed.length === 0 && requiredPending.length === 0;

  if (!allRequiredPassed && !aborted) {
    const failedIds = requiredFailed.map((r) => r.gateId).join(', ');
    const pendingIds = requiredPending.map((r) => r.gateId).join(', ');
    const fresh = backgroundTaskRepo.getTask(taskId);
    if (fresh && !TERMINAL_STATUSES.has(fresh.status)) {
      if (requiredFailed.length === 0 && requiredPending.length > 0) {
        // P20 — human approval gates: the task is READY but awaits a human.
        // Non-terminal waiting_approval (never failed/completed) so the
        // explicit approval endpoint can complete it later.
        backgroundTaskManager.transition(taskId, 'waiting_approval', {
          verificationState: 'pending',
          currentStage: 'awaiting_human_approval',
          blocker: `Awaiting human approval: ${pendingIds}`,
          resumable: false,
        });
      } else {
        const reasonParts = [];
        if (failedIds) reasonParts.push(`failed: ${failedIds}`);
        if (pendingIds) reasonParts.push(`awaiting approval: ${pendingIds}`);
        const retryable = requiredFailed.some((r) => gates.find((g) => g.id === r.gateId)?.retryOnFail) && (fresh.attempt || 1) <= 3;
        backgroundTaskManager.transition(taskId, retryable ? 'blocked' : 'failed', {
          verificationState: 'failed',
          currentStage: 'verification_failed',
          blocker: `Verification failed — ${reasonParts.join('; ')}`,
          lastError: requiredFailed.map((r) => `${r.gateId}: ${r.reason}`).join(' | ').slice(0, 300),
          resumable: retryable,
        });
      }
    }
  }

  return { runId: task.linkedRunId || task.taskId, taskId, results, allRequiredPassed, anyFailed, startedAt, completedAt: new Date().toISOString() };
}
