/**
 * workerAdapters/magnitudeAdapter.ts
 *
 * Bridges a canonical ProjectTask to the existing MagnitudeService runtime.
 *
 * Preserves the Magnitude implementation proven in Task 0.
 * Does NOT extend Magnitude into form submission / purchasing.
 */

import { magnitudeService } from '../magnitude/service.js';
import { executionRunService } from '../../services/projectExecution/executionRunService.js';
import { projectTaskService } from '../../services/projectExecution/projectTaskService.js';
import { classifyAction } from '../../services/actionClassifier.js';
import { logger } from '../../utils/logger.js';
import type { ProjectTaskRecord } from '../../services/projectExecution/projectTaskService.js';
import type { ExecutionRunRecord } from '../../services/projectExecution/executionRunService.js';

export interface MagnitudeAdapterResult {
  run: ExecutionRunRecord;
  magnitudeRunId: string;
}

/**
 * Execute a canonical project task using the existing Magnitude service.
 *
 * Flow:
 *   ProjectTask → MagnitudeAdapter → MagnitudeService.executeInspect()
 *              ↓
 *   ExecutionRun (canonical) ← agent_instance_id = magnitude_runs.id
 */
export async function executeMagnitudeTask(
  task: ProjectTaskRecord,
  options: {
    goal?: string; // override — defaults to task.description or task.title
    conversationId?: string;
    requestId?: string;
    approved?: boolean;
    scheduleExecutionId?: string;
  } = {},
): Promise<MagnitudeAdapterResult> {
  const goal = options.goal ?? task.description ?? task.title;
  const now = new Date().toISOString();

  // Safety classification — READ_ONLY inspection only in this phase
  const { permitted, classification } = (() => {
    const cls = classifyAction(goal, 'magnitude', options.approved ?? false);
    return { permitted: !cls.blocked, classification: cls };
  })();

  if (!permitted) {
    logger.warn(`[MagnitudeAdapter] Action blocked by classifier: ${classification.reason}`);
    throw new Error(`Action blocked: ${classification.reason} (class: ${classification.actionClass})`);
  }

  // Create a Magnitude run in the existing runtime — carry canonical
  // provenance (projectId, projectTaskId, executionRunId) so browser evidence
  // is project-owned from the moment the run exists (A5).
  const magRun = magnitudeService.createRun(
    goal,
    'inspect',
    options.conversationId,
    {
      projectId: task.projectId,
      projectTaskId: task.id,
      // scheduleExecutionId lives on the task row metadata for scheduled runs;
      // the adapter's canonical caller (scheduleDispatcher) passes it via
      // options when available.
      scheduleExecutionId: options.scheduleExecutionId,
    },
  );
  logger.info(`[MagnitudeAdapter] Magnitude run ${magRun.id} created for task ${task.id} (project ${task.projectId})`);

  // Create canonical execution run
  const run = executionRunService.createRun({
    taskId: task.id,
    projectId: task.projectId,
    goalId: task.goalId,
    workerType: 'magnitude',
    agentInstanceId: magRun.id,
    trigger: 'api',
    requestId: options.requestId,
    conversationId: options.conversationId,
    metadata: {
      magnitudeRunId: magRun.id,
      actionClass: classification.actionClass,
    },
  });

  executionRunService.updateRun(run.id, { status: 'running', startTime: now });
  projectTaskService.updateTask(task.id, {
    status: 'running',
    assignedRunId: run.id,
    startedAt: now,
  });

  executionRunService.emitEvent({
    projectId: task.projectId,
    goalId: task.goalId,
    taskId: task.id,
    runId: run.id,
    worker: 'magnitude',
    eventType: 'MAGNITUDE_RUN_STARTED',
    payload: { magnitudeRunId: magRun.id, goal, actionClass: classification.actionClass },
  });

  // Execute asynchronously — attach completion handler
  magnitudeService.executeInspect(magRun.id).then(async (magResult) => {
    const endNow = new Date().toISOString();
    // executeInspect returns MagnitudeInspectResult on success (throws on failure)
    const isSuccess = !!magResult && !!magResult.url;

    if (isSuccess) {
      const result = executionRunService.createResult({
        runId: run.id,
        taskId: task.id,
        status: 'completed',
        summary: magResult.title ?? magResult.text?.slice(0, 200) ?? 'Magnitude inspection completed',
        structuredOutput: {
          magnitudeRunId: magRun.id,
          url: magResult.url,
          finalUrl: magResult.finalUrl,
          title: magResult.title,
          text: magResult.text,
          metaDescription: magResult.metaDescription,
          linksCount: magResult.linksCount,
          durationMs: magResult.durationMs,
        },
        metadata: { magnitudeRunId: magRun.id },
      });

      executionRunService.updateRun(run.id, {
        status: 'completed',
        endTime: endNow,
        provider: 'magnitude-chromium',
        model: 'playwright-headless',
      });

      projectTaskService.updateTask(task.id, { status: 'completed', completedAt: endNow });

      executionRunService.emitEvent({
        projectId: task.projectId,
        goalId: task.goalId,
        taskId: task.id,
        runId: run.id,
        worker: 'magnitude',
        eventType: 'MAGNITUDE_RUN_COMPLETED',
        payload: { magnitudeRunId: magRun.id, resultId: result.id },
      });
    } else {
      // executeInspect threw — the catch block below handles it
      // This else path is reached when magResult is falsy (should not happen)
      executionRunService.updateRun(run.id, {
        status: 'failed',
        endTime: endNow,
        failureReason: 'Magnitude inspection returned no result',
      });
      projectTaskService.updateTask(task.id, { status: 'failed' });
    }
  }).catch((err: Error) => {
    logger.error(`[MagnitudeAdapter] Magnitude run ${magRun.id} threw:`, err.message);
    const endNow = new Date().toISOString();
    executionRunService.updateRun(run.id, {
      status: 'failed',
      endTime: endNow,
      failureReason: err.message,
    });
    projectTaskService.updateTask(task.id, { status: 'failed' });
  });

  return { run, magnitudeRunId: magRun.id };
}
