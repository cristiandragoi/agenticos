/**
 * workerAdapters/hermesAdapter.ts
 *
 * Canonical worker adapter for Hermes.
 * Bridges a canonical ProjectTask to the authoritative HermesService.
 */

import { hermesService } from '../hermes/service.js';
import type { ProjectTaskRecord } from '../../services/projectExecution/projectTaskService.js';
import type { ExecutionRunRecord } from '../../services/projectExecution/executionRunService.js';

export interface HermesAdapterResult {
  run: ExecutionRunRecord;
  hermesRunId: string;
}

/**
 * Execute a canonical project task using the canonical Hermes service.
 */
export async function executeHermesTask(
  task: ProjectTaskRecord,
  options: {
    prompt?: string;
    conversationId?: string;
    requestId?: string;
    projectId?: string;
    goalId?: string;
  } = {}
): Promise<HermesAdapterResult> {
  return await hermesService.executeTask(task, options);
}

/**
 * Cancel an active Hermes execution.
 */
export async function cancelHermesTask(runId: string, reason?: string): Promise<boolean> {
  return await hermesService.cancelRun(runId, reason);
}
