/**
 * projectExecution/index.ts
 *
 * Initializes the canonical project execution schema and exports all services.
 * Import this module from server/src/index.ts to wire up on startup.
 */
export { initProjectExecutionSchema } from './schema.js';
export { projectTaskService } from './projectTaskService.js';
export { executionRunService } from './executionRunService.js';
export { verificationService } from './verificationService.js';
