// Self-Heal Domain — Barrel Export (Governance-Hardened v2)
export { failureDetector } from './FailureDetector.js';
export { traceCollector } from './TraceCollector.js';
export { repairDiagnostician } from './RepairDiagnostician.js';
export { repairPlanner } from './RepairPlanner.js';
export { repairExecutor } from './RepairExecutor.js';
export { repairTestRunner } from './RepairTestRunner.js';
export { repairVerifier } from './RepairVerifier.js';
export { deploymentGate, computePatchHash } from './DeploymentGate.js';
export { repairMemory } from './RepairMemory.js';
export { auditLog } from './AuditLog.js';
export { snapshotManager } from './SnapshotManager.js';
export { selfHealSupervisor } from './SelfHealSupervisor.js';
export * from './types.js';
