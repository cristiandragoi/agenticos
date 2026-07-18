import type { RunRecord } from '../types.js';

/**
 * Transition helper that simulates applying the API schema changes
 * approved by the user for run-004.
 */
export function approveSchemaRun(run: RunRecord): RunRecord {
  const updatedRun = { ...run };
  
  updatedRun.status = 'completed';
  updatedRun.output = "API schema updated successfully. Renamed `userId` to `accountId`, removed `legacyAuth` field, and added required `scopeId` parameter. Affected clients updated.";
  
  const newLogs = [
    "[00:15] User approved all 3 changes.",
    "[00:16] Updating API schema and clients...",
    "[00:18] Run completed."
  ];
  
  updatedRun.logs = [...(updatedRun.logs || []), ...newLogs];
  updatedRun.updatedAt = new Date().toISOString();
  
  return updatedRun;
}
