/**
 * workerAdapters/codexAdapter.ts
 *
 * Bridges a canonical ProjectTask to the existing CodeX goal runtime.
 *
 * Does NOT duplicate the CodeX sandbox, goal loop, tool protocol, or
 * persistence. Only creates the canonical execution_runs record and
 * links it to an existing CodeX goal.
 */

import { randomUUID } from 'crypto';
import { goalStore } from '../../services/goalStore.js';
import { executionRunService } from '../../services/projectExecution/executionRunService.js';
import { projectTaskService } from '../../services/projectExecution/projectTaskService.js';
import { parseTypedFindingsFromText, buildStructuredFindings } from '../../services/projectExecution/findings.js';
import { parseVerdictsFromText, buildProvenanceFields } from '../../services/projectExecution/resultProvenance.js';
import type { ResultProvenance, ResultType } from '../../services/projectExecution/resultProvenance.js';
import { logger } from '../../utils/logger.js';
import type { ProjectTaskRecord } from '../../services/projectExecution/projectTaskService.js';
import type { ExecutionRunRecord } from '../../services/projectExecution/executionRunService.js';

export interface CodexAdapterResult {
  run: ExecutionRunRecord;
  goalId: string;
}

/**
 * Execute a canonical project task using the existing CodeX goal runtime.
 *
 * Flow:
 *   ProjectTask → CodexAdapter → goalStore.create() → existing CodeX runtime
 *               ↓
 *   ExecutionRun (canonical) ← agent_instance_id = CodeX goalId
 */
export async function executeCodexTask(
  task: ProjectTaskRecord,
  options: {
    workspacePath?: string;
    conversationId?: string;
    requestId?: string;
  } = {},
): Promise<CodexAdapterResult> {
  const now = new Date().toISOString();
  const goalId = `goal-${randomUUID().slice(0, 8)}`;

  // Create the CodeX goal using the existing goal store
  const codeXGoal = goalStore.create({
    id: goalId,
    originalGoal: `[Project Task: ${task.id}]\n\nProject: ${task.projectId}\nGoal: ${task.goalId}\n\nTask: ${task.title}\n${task.description ? `\nDescription: ${task.description}` : ''}\n${task.acceptanceCriteria ? `\nAcceptance Criteria: ${task.acceptanceCriteria}` : ''}`,
    status: 'queued',
    retryCount: 0,
    providerFallbackCount: 0,
    createdAt: now,
    updatedAt: now,
    workspacePath: options.workspacePath ?? undefined,
    conversationId: options.conversationId ?? undefined,
    workspaceId: undefined,
    history: [],
  });

  logger.info(`[CodexAdapter] Created CodeX goal ${goalId} for task ${task.id}`);

  // Create canonical execution run linked to this task
  const run = executionRunService.createRun({
    taskId: task.id,
    projectId: task.projectId,
    goalId: task.goalId,
    workerType: 'codex',
    agentInstanceId: goalId, // CodeX goal ID
    trigger: 'api',
    requestId: options.requestId,
    conversationId: options.conversationId,
    metadata: { codeXGoalId: goalId },
  });

  executionRunService.updateRun(run.id, { status: 'running', startTime: now });
  projectTaskService.updateTask(task.id, {
    status: 'running',
    assignedRunId: run.id,
    startedAt: now,
  });

  // Emit start event
  executionRunService.emitEvent({
    projectId: task.projectId,
    goalId: task.goalId,
    taskId: task.id,
    runId: run.id,
    worker: 'codex',
    eventType: 'CODEX_GOAL_CREATED',
    payload: { goalId, runId: run.id, taskId: task.id },
  });

  logger.info(`[CodexAdapter] Execution run ${run.id} created, CodeX goal ${goalId} queued`);
  return { run, goalId };
}

/**
 * Build the authoritative `structured_output` for a completed CodeX goal,
 * including typed findings parsed ONCE at the completion boundary.
 *
 * `finalAnswerText` (optional) overrides the goal's own runSummary finalAnswer
 * so a caller that has the final answer in hand (before the goal store write)
 * can still produce a correct result.
 *
 * `provenance` (optional) carries the semantic type + relationships for this
 * result (resultType, verificationOfResultId, sourceResultId, …). For a
 * verification result, per-finding verdicts are parsed (finding-id keyed) and
 * persisted under `verdicts`.
 */
function buildStructuredOutputFromGoal(
  goal: any,
  goalId: string,
  finalAnswerText?: string,
  provenance?: ResultProvenance,
): Record<string, unknown> {
  const runSummaryObj = typeof goal.runSummary === 'object' && goal.runSummary !== null
    ? goal.runSummary as any
    : null;
  const changedFiles = Array.isArray(runSummaryObj?.changedFiles) ? runSummaryObj.changedFiles : [];
  const text = finalAnswerText ?? String(
    runSummaryObj?.finalAnswer ||
    runSummaryObj?.summary ||
    runSummaryObj?.finalUserMessage ||
    (typeof goal.runSummary === 'string' ? goal.runSummary : '')
  );
  // TRANSITIONAL: typed findings are parsed once here, at the worker
  // completion boundary, and persisted. Downstream consumers must read
  // `findings`, never reparse finalAnswer.
  const findings = parseTypedFindingsFromText(text);
  const provFields = provenance ? buildProvenanceFields(provenance) : {};
  // Verification results carry finding-id keyed verdicts (machine-level
  // linkage back to the analysis findings they verify).
  const verdicts = provenance?.resultType === 'verification' ? parseVerdictsFromText(text) : [];
  return {
    goalId,
    status: goal.status,
    ...provFields,
    changedFiles,
    filesRead: runSummaryObj?.filesRead ?? 0,
    filesModified: runSummaryObj?.filesModified ?? 0,
    commandsExecuted: runSummaryObj?.commandsExecuted ?? 0,
    ...buildStructuredFindings(findings, 'legacy_text_fallback'),
    ...(verdicts.length > 0 ? { verdicts } : {}),
    runSummary: goal.runSummary,
  };
}

/**
 * Derive result provenance from the canonical run's metadata. The Jarvis
 * orchestrator sets `resultType` (and, for verification runs,
 * `verificationOfResultId`/`sourceResultId`) on the run at dispatch time;
 * reconciliation copies it into the persisted result so the graph is
 * authoritative and restart-safe.
 */
function provenanceFromRunMetadata(run: ExecutionRunRecord): ResultProvenance {
  const m = (run.metadata || {}) as Record<string, unknown>;
  return {
    resultType: (m.resultType as ResultType) || undefined,
    sourceResultId: typeof m.sourceResultId === 'string' ? m.sourceResultId : undefined,
    verificationOfResultId: typeof m.verificationOfResultId === 'string' ? m.verificationOfResultId : undefined,
    parentResultId: typeof m.parentResultId === 'string' ? m.parentResultId : undefined,
    supersedesResultId: typeof m.supersedesResultId === 'string' ? m.supersedesResultId : undefined,
    resultVersion: typeof m.resultVersion === 'number' ? m.resultVersion : undefined,
  };
}

/**
 * Reconcile a completed CodeX goal with its canonical execution run.
 * Call this after the CodeX goal reaches terminal status.
 */
export async function reconcileCodexRun(
  runId: string,
  goalId: string,
): Promise<ExecutionRunRecord | null> {
  const goal = goalStore.get(goalId);
  if (!goal) {
    logger.warn(`[CodexAdapter] Goal ${goalId} not found during reconciliation`);
    return null;
  }

  const run = executionRunService.getRun(runId);
  if (!run) return null;

  const isCompleted = goal.status === 'completed';
  const isFailed = goal.status === 'failed' || goal.status === 'stopped';
  const now = new Date().toISOString();

  if (isCompleted) {
    const runSummaryObj = typeof goal.runSummary === 'object' && goal.runSummary !== null
      ? goal.runSummary as any
      : null;
    const changedFiles = Array.isArray(runSummaryObj?.changedFiles) ? runSummaryObj.changedFiles : [];
    const summary = runSummaryObj?.finalAnswer || runSummaryObj?.summary || runSummaryObj?.finalUserMessage || (typeof goal.runSummary === 'string' ? goal.runSummary : 'CodeX goal completed');

    const result = executionRunService.createResult({
      runId,
      taskId: run.taskId,
      status: 'completed',
      summary,
      structuredOutput: buildStructuredOutputFromGoal(goal, goalId, undefined, provenanceFromRunMetadata(run)),
      artifactRefs: changedFiles,
      metadata: { codeXGoalId: goalId, ...provenanceFromRunMetadata(run) },
    });

    executionRunService.updateRun(runId, {
      status: 'completed',
      endTime: now,
      provider: (goal as any).provider ?? runSummaryObj?.provider ?? null,
      model: (goal as any).model ?? runSummaryObj?.model ?? null,
    });

    projectTaskService.updateTask(run.taskId, {
      status: 'completed',
      completedAt: now,
    });

    executionRunService.emitEvent({
      projectId: run.projectId,
      goalId: run.goalId,
      taskId: run.taskId,
      runId,
      worker: 'codex',
      eventType: 'CODEX_GOAL_COMPLETED',
      payload: { goalId, resultId: result.id },
    });
  } else if (isFailed) {
    executionRunService.updateRun(runId, {
      status: 'failed',
      endTime: now,
      failureReason: `CodeX goal status: ${goal.status}`,
    });

    projectTaskService.updateTask(run.taskId, { status: 'failed' });
  }

  return executionRunService.getRun(runId);
}

/**
 * Reconcile a completed CodeX goal to its canonical execution result, resolving
 * the run by `agent_instance_id` (the goal id) — used by the Jarvis path, which
 * only knows the goal id at completion time.
 *
 * Idempotent: if a result already exists for the resolved run, it is returned
 * unchanged (no duplicate `execution_results` row).
 *
 * Returns the result/run ids, or nulls when no run is linked or reconciliation
 * fails (never throws — the conversation/grounding path must not break on a
 * missing canonical row).
 */
export async function reconcileGoalToResult(
  goalId: string,
  finalAnswerText: string,
): Promise<{
  resultId: string | null;
  runId: string | null;
  resultType?: string;
  verificationOfResultId?: string;
}> {
  try {
    const goal = goalStore.get(goalId);
    if (!goal) return { resultId: null, runId: null };

    const run = executionRunService.getRunByAgentInstanceId(goalId);
    if (!run) return { resultId: null, runId: null };

    // Idempotency: exactly-once result per run.
    const existing = executionRunService.getResultForRun(run.id);
    if (existing) {
      const s = (existing.structuredOutput || {}) as any;
      return {
        resultId: existing.id,
        runId: run.id,
        resultType: s.resultType,
        verificationOfResultId: s.verificationOfResultId,
      };
    }

    const runSummaryObj = typeof goal.runSummary === 'object' && goal.runSummary !== null
      ? goal.runSummary as any
      : null;
    const changedFiles = Array.isArray(runSummaryObj?.changedFiles) ? runSummaryObj.changedFiles : [];
    const provenance = provenanceFromRunMetadata(run);
    const structuredOutput = buildStructuredOutputFromGoal(goal, goalId, finalAnswerText, provenance);
    // The goal's own status may still be 'running' at this completion
    // boundary; the reconciled result is definitively completed.
    structuredOutput.status = 'completed';

    const result = executionRunService.createResult({
      runId: run.id,
      taskId: run.taskId,
      status: 'completed',
      summary: finalAnswerText || runSummaryObj?.summary || 'CodeX goal completed',
      structuredOutput,
      artifactRefs: changedFiles,
      metadata: { codeXGoalId: goalId, ...provenance },
    });

    executionRunService.updateRun(run.id, {
      status: 'completed',
      endTime: new Date().toISOString(),
      provider: (goal as any).provider ?? runSummaryObj?.provider ?? null,
      model: (goal as any).model ?? runSummaryObj?.model ?? null,
    });

    try {
      projectTaskService.updateTask(run.taskId, { status: 'completed', completedAt: new Date().toISOString() });
    } catch {
      // task row may not exist for every path — non-fatal
    }

    logger.info(`[CodexAdapter] Reconciled goal ${goalId} → result ${result.id} (${structuredOutput.findingsCount} typed findings)`);
    return {
      resultId: result.id,
      runId: run.id,
      resultType: provenance.resultType,
      verificationOfResultId: provenance.verificationOfResultId,
    };
  } catch (err: any) {
    logger.warn(`[CodexAdapter] reconcileGoalToResult failed (non-blocking): ${err?.message}`);
    return { resultId: null, runId: null };
  }
}
