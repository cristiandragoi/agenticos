/**
 * workerAdapters/hermesAdapter.ts
 *
 * Canonical worker adapter for Hermes.
 * Bridges a canonical ProjectTask to the authoritative HermesService.
 */
import { hermesService } from '../hermes/service.js';
/**
 * Execute a canonical project task using the canonical Hermes service.
 */
export async function executeHermesTask(task, options = {}) {
    return await hermesService.executeTask(task, options);
}
/**
 * Cancel an active Hermes execution.
 */
export async function cancelHermesTask(runId, reason) {
    return await hermesService.cancelRun(runId, reason);
}
