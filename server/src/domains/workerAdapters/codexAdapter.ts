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
      structuredOutput: {
        goalId,
        status: goal.status,
        changedFiles,
        filesRead: runSummaryObj?.filesRead ?? 0,
        filesModified: runSummaryObj?.filesModified ?? 0,
        commandsExecuted: runSummaryObj?.commandsExecuted ?? 0,
        runSummary: goal.runSummary,
      },
      artifactRefs: changedFiles,
      metadata: { codeXGoalId: goalId },
    });

    executionRunService.updateRun(runId, {
      status: 'completed',
      endTime: now,
      provider: (goal as any).provider ?? null,
      model: (goal as any).model ?? null,
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
