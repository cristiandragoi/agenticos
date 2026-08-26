/**
 * revenueEngine.ts — Revenue Operator engine orchestration.
 *
 * EXTENDS the canonical Agentic OS execution surface. It does NOT create any
 * parallel scheduler/task/run/verifier infrastructure. The engine drives the
 * Revenue domain (missions/experiments/ledger) while dispatching actual work
 * through the canonical path:
 *
 *   project → goal (projectTaskService) → task (projectTaskService)
 *     → worker adapter (hermes/codex/magnitude)
 *     → execution run + result (executionRunService)
 *     → independent verification (verificationService)
 *
 * Canonical run/task/goal ids are linked back onto the revenue experiment via
 * linkExperimentRun() so provenance is traceable in one direction only.
 */
import { randomUUID } from 'crypto';
import { projectsStore } from '../projectsStore.js';
import { projectTaskService } from '../projectExecution/projectTaskService.js';
import { executionRunService } from '../projectExecution/executionRunService.js';
import { verificationService } from '../projectExecution/verificationService.js';
import type { WorkerType } from '../projectExecution/schema.js';
import { logger } from '../../utils/logger.js';

export type RevenueWorker = 'hermes' | 'codex' | 'magnitude';

export interface CanonicalDispatchInput {
  projectId: string;
  worker: RevenueWorker;
  title: string;
  objective: string;
  taskType?: string;
  acceptanceCriteria?: string;
  requestId?: string;
  timeoutMs?: number;
}

export interface CanonicalDispatchOutcome {
  ok: boolean;
  goalId: string;
  taskId: string;
  runId: string | null;
  resultId: string | null;
  verdict: string | null;
  summary: string | null;
  structuredOutput?: Record<string, unknown> | null;
  error: string | null;
}

/** Resolve a canonical project id, falling back to the active project. */
export function resolveProjectId(preferred?: string | null): string | null {
  if (preferred && projectsStore.getProject(preferred)) return preferred;
  const active = projectsStore.getActiveProjectId();
  if (active && projectsStore.getProject(active)) return active;
  const all = projectsStore.listProjects();
  return all.length > 0 ? all[0].id : null;
}

/**
 * Dispatch one canonical worker task and await a terminal run, then run the
 * canonical verifier (for hermes/codex; magnitude is read-only). Mirrors the
 * proven scheduleDispatcher flow, minus the schedule/routine-specific wrapper.
 */
export async function dispatchCanonicalTask(input: CanonicalDispatchInput): Promise<CanonicalDispatchOutcome> {
  const requestId = input.requestId ?? `rev-${randomUUID().slice(0, 8)}`;

  const goal = projectTaskService.createGoal({
    projectId: input.projectId,
    title: input.title,
    objective: input.objective,
    createdBy: 'revenue-operator',
    metadata: { revenueOperator: true, requestId },
  });

  const task = projectTaskService.createTask({
    projectId: input.projectId,
    goalId: goal.id,
    title: input.title,
    description: input.objective,
    taskType: input.taskType ?? (input.worker === 'codex' ? 'engineering' : input.worker === 'magnitude' ? 'browser' : 'research'),
    assignedCapability: input.worker as WorkerType,
    acceptanceCriteria: input.acceptanceCriteria ?? `Execute the revenue objective and return a structured result.`,
    metadata: { revenueOperator: true, requestId },
  });

  let runId: string | null = null;

  try {
    if (input.worker === 'hermes') {
      const { executeHermesTask } = await import('../../domains/workerAdapters/hermesAdapter.js');
      const { run } = await executeHermesTask(task, { prompt: input.objective, requestId, projectId: input.projectId, goalId: goal.id });
      runId = run.id;
    } else if (input.worker === 'magnitude') {
      const { executeMagnitudeTask } = await import('../../domains/workerAdapters/magnitudeAdapter.js');
      const { run } = await executeMagnitudeTask(task, { goal: input.objective, requestId });
      runId = run.id;
    } else {
      // codex: queue the goal, start the loop, poll the goal to terminal, reconcile.
      const { executeCodexTask, reconcileCodexRun } = await import('../../domains/workerAdapters/codexAdapter.js');
      const { resumeCodexGoalLoop } = await import('../../loops/codexLoop.js');
      const { goalStore } = await import('../../services/goalStore.js');
      const { getWorkspaceRoot } = await import('../workspaceStore.js');
      const { run, goalId } = await executeCodexTask(task, { workspacePath: getWorkspaceRoot(), requestId });
      runId = run.id;
      resumeCodexGoalLoop(goalId).catch((e) => logger.warn(`[revenue-engine] codex loop start error: ${(e as any)?.message}`));
      const codexDeadline = Date.now() + (input.timeoutMs ?? 300000);
      let terminalGoal: any = null;
      while (Date.now() < codexDeadline) {
        const g = goalStore.get(goalId);
        if (g && (g.status === 'completed' || g.status === 'failed' || g.status === 'stopped')) { terminalGoal = g; break; }
        await new Promise((res) => setTimeout(res, 1500));
      }
      if (terminalGoal) await reconcileCodexRun(runId, goalId);
    }
  } catch (err: any) {
    logger.error('[revenue-engine] dispatch error', err?.message);
    return { ok: false, goalId: goal.id, taskId: task.id, runId, resultId: null, verdict: null, summary: null, error: err?.message ?? 'dispatch failed' };
  }

  if (!runId) {
    return { ok: false, goalId: goal.id, taskId: task.id, runId: null, resultId: null, verdict: null, summary: null, error: 'No run id produced by worker dispatch.' };
  }

  // ── Poll the canonical run to terminal ────────────────────────────────────
  const timeoutMs = input.timeoutMs ?? 300000;
  const deadline = Date.now() + timeoutMs;
  let terminalRun: any = null;
  while (Date.now() < deadline) {
    const r = executionRunService.getRun(runId);
    if (r && (r.status === 'completed' || r.status === 'failed' || r.status === 'cancelled')) { terminalRun = r; break; }
    await new Promise((res) => setTimeout(res, 1500));
  }
  if (!terminalRun) {
    return { ok: false, goalId: goal.id, taskId: task.id, runId, resultId: null, verdict: null, summary: null, error: `Timed out after ${Math.round(timeoutMs / 1000)}s.` };
  }

  const finalResult = terminalRun.finalResultId ? executionRunService.getResult(terminalRun.finalResultId) : null;

  // ── Independent verification (hermes/codex only) ──────────────────────────
  let verdict: string | null = null;
  if (input.worker !== 'magnitude' && terminalRun.status === 'completed' && finalResult) {
    try {
      const vr = await verificationService.verify({
        taskId: task.id,
        targetRunId: runId,
        projectId: input.projectId,
        goalId: goal.id,
        objective: input.objective,
        acceptanceCriteria: task.acceptanceCriteria,
        workerResult: finalResult,
        workerRun: terminalRun,
      });
      verdict = vr.verdict;
    } catch (e: any) {
      logger.warn(`[revenue-engine] verification error (non-fatal): ${(e as any)?.message}`);
    }
  }

  const ok = terminalRun.status === 'completed';
  return {
    ok,
    goalId: goal.id,
    taskId: task.id,
    runId,
    resultId: finalResult?.id ?? null,
    verdict,
    summary: finalResult?.summary ?? terminalRun.failureReason ?? null,
    structuredOutput: (finalResult?.structuredOutput as Record<string, unknown> | null) ?? null,
    error: ok ? null : (terminalRun.failureReason || `Worker ended ${terminalRun.status}`),
  };
}

/**
 * Pure GO/NO-GO decision from a normalized opportunity score.
 * Conservative threshold: a neutral profile (≈0.25 with the operator scoring
 * formula) is NO-GO; a genuine demand/margin signal is required to proceed.
 */
export function decideGoNoGo(overallScore: number, threshold = 0.35): { go: boolean; reason: string } {
  if (!Number.isFinite(overallScore)) return { go: false, reason: 'Score is not finite.' };
  if (overallScore >= threshold) return { go: true, reason: `Score ${overallScore.toFixed(3)} >= threshold ${threshold}.` };
  return { go: false, reason: `Score ${overallScore.toFixed(3)} < threshold ${threshold}.` };
}
