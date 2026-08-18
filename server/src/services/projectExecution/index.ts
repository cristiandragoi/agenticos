/**
 * projectExecution/index.ts
 *
 * Initializes the canonical project execution schema and exports all services.
 * Import this module from server/src/index.ts to wire up on startup.
 */

export { initProjectExecutionSchema } from './schema.js';
export { projectTaskService } from './projectTaskService.js';
export type { ProjectGoalRecord, ProjectTaskRecord } from './projectTaskService.js';
export { executionRunService } from './executionRunService.js';
export type { ExecutionRunRecord, ExecutionResultRecord, ExecutionEventRecord } from './executionRunService.js';
export { verificationService } from './verificationService.js';
export type { VerificationRecord, VerificationInput, VerificationOutput } from './verificationService.js';
export type { TaskStatus, RunStatus, VerificationVerdict, WorkerType, ActionClass } from './schema.js';
