// Self-Heal Domain — Core Type Definitions (Governance-Hardened)
// SELFHEAL GOVERNANCE v2 — addresses all 7 failures from JARVIS-SELFHEAL-001

// ── Enforced State Machine ──────────────────────────────────────────────────
// No stage may skip forward. All transitions validated by assertTransition().

export type IncidentStatus =
  | 'CREATED'
  | 'COLLECTING_EVIDENCE'
  | 'DIAGNOSING'
  | 'DIAGNOSIS_COMPLETE'
  | 'SNAPSHOTTING'
  | 'PLANNING'
  | 'REPAIRING'
  | 'TESTING'
  | 'VERIFYING'
  | 'AWAITING_APPROVAL'
  | 'APPROVED'
  | 'DEPLOYING'
  | 'MONITORING'
  | 'COMPLETED'
  // Blocked terminal states
  | 'BLOCKED_MODEL_UNAVAILABLE'
  | 'BLOCKED_SNAPSHOT_INVALID'
  | 'BLOCKED_TEST_FAILURE'
  | 'BLOCKED_VERIFIER_UNAVAILABLE'
  | 'BLOCKED_APPROVAL_REQUIRED'
  | 'BLOCKED_MAX_ATTEMPTS_EXCEEDED'
  | 'INVALID_MISCLASSIFIED';

/** Legal state transitions — whitelist. Anything not listed is ILLEGAL. */
const LEGAL_TRANSITIONS: ReadonlyArray<[IncidentStatus, IncidentStatus]> = [
  ['CREATED', 'COLLECTING_EVIDENCE'],
  ['CREATED', 'INVALID_MISCLASSIFIED'],
  ['COLLECTING_EVIDENCE', 'DIAGNOSING'],
  ['COLLECTING_EVIDENCE', 'SNAPSHOTTING'],
  ['COLLECTING_EVIDENCE', 'BLOCKED_MODEL_UNAVAILABLE'],
  ['COLLECTING_EVIDENCE', 'INVALID_MISCLASSIFIED'],
  ['SNAPSHOTTING', 'DIAGNOSING'],
  ['SNAPSHOTTING', 'PLANNING'],
  ['SNAPSHOTTING', 'BLOCKED_SNAPSHOT_INVALID'],
  ['DIAGNOSING', 'DIAGNOSIS_COMPLETE'],
  ['DIAGNOSING', 'BLOCKED_MODEL_UNAVAILABLE'],
  ['DIAGNOSIS_COMPLETE', 'SNAPSHOTTING'],
  ['DIAGNOSIS_COMPLETE', 'PLANNING'],
  ['PLANNING', 'REPAIRING'],
  ['PLANNING', 'BLOCKED_MAX_ATTEMPTS_EXCEEDED'],
  ['PLANNING', 'INVALID_MISCLASSIFIED'],
  ['REPAIRING', 'TESTING'],
  ['REPAIRING', 'BLOCKED_MAX_ATTEMPTS_EXCEEDED'],
  ['TESTING', 'VERIFYING'],
  ['TESTING', 'BLOCKED_TEST_FAILURE'],
  ['VERIFYING', 'AWAITING_APPROVAL'],
  ['VERIFYING', 'BLOCKED_VERIFIER_UNAVAILABLE'],
  ['AWAITING_APPROVAL', 'APPROVED'],       // ONLY via explicit API call
  ['AWAITING_APPROVAL', 'BLOCKED_APPROVAL_REQUIRED'],
  ['APPROVED', 'DEPLOYING'],
  ['DEPLOYING', 'MONITORING'],
  ['MONITORING', 'COMPLETED'],
  ['COMPLETED', 'INVALID_MISCLASSIFIED'],
];

export class StateViolationError extends Error {
  constructor(message: string) { super(message); this.name = 'StateViolationError'; }
}

/** Throws StateViolationError if the transition is not in the whitelist. */
export function assertTransition(from: IncidentStatus, to: IncidentStatus): void {
  const legal = LEGAL_TRANSITIONS.some(([f, t]) => f === from && t === to);
  if (!legal) {
    throw new StateViolationError(`Illegal state transition: ${from} → ${to}`);
  }
}

// ── Failure Domain ──────────────────────────────────────────────────────────

export type FailureDomain = 'renderer' | 'backend' | 'browser' | 'voice' | 'database' | 'livekit' | 'model_gateway' | 'hermes' | 'codex' | 'argus' | 'electron' | 'build' | 'deployment' | 'network' | 'routing' | 'discovery' | 'permission' | 'execution' | 'perception' | 'verification' | 'integration' | 'runtime' | 'implementation' | 'unknown';

export type FailureDomainType =
  | 'routing'
  | 'discovery'
  | 'permission'
  | 'execution'
  | 'perception'
  | 'verification'
  | 'integration'
  | 'runtime'
  | 'implementation'
  | 'backend'
  | 'unknown';

export type RepairabilityType = 'operational' | 'engineering' | 'external_blocker' | 'unknown';

export interface UserGoalAction {
  verb: string;
  target: string;
  prompt?: string;
  originalPrompt?: string;
  entityId?: string;
  entityType?: string;
  entityName?: string;
  conversationId?: string;
}

export interface SystemFailureClassification {
  domain: FailureDomainType;
  repairability: RepairabilityType;
  reason?: string;
  evidenceIds?: string[];
}

export interface RepairContext {
  incidentId: string;
  goalId?: string;
  conversationId: string;
  turnId?: string;
  attemptId?: string;
  originalUserInput: string;
  normalizedGoal?: string;
  capabilityId: string;
  target: string;
  failureEvidence?: any[];
  failureEvidenceIds?: string[];
  failureClassification?: SystemFailureClassification;
  userAction?: UserGoalAction;
  currentBuildId?: string;
  approver?: string;
  originalAction?: {
    prompt: string;
    conversationId: string;
    entityId: string;
    entityType: string;
    entityName: string;
    verb: string;
  };
  requiresPhysicalUserVerification?: boolean;
  resumeFromDiagnosing?: boolean;
}

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export type CostMode = 'local_only' | 'economy' | 'standard' | 'deep_repair';

// ── Model Identity (F1, F3) ─────────────────────────────────────────────────

export class ModelUnavailableError extends Error {
  constructor(message: string) { super(message); this.name = 'ModelUnavailableError'; }
}

export class VerifierUnavailableError extends Error {
  constructor(message: string) { super(message); this.name = 'VerifierUnavailableError'; }
}

export interface ModelIdentityRecord {
  requestedProvider: string;
  requestedModel: string;
  actualProvider: string;
  actualModel: string;
  requestId: string;
  fallbackUsed: boolean;
  fallbackAuthorized: boolean;
  verified: boolean;  // actualModel === requestedModel AND non-empty reply
}

// ── Approval Gate (F4) ──────────────────────────────────────────────────────

export class DeploymentDeniedError extends Error {
  constructor(message: string) { super(message); this.name = 'DeploymentDeniedError'; }
}

export interface ApprovalRecord {
  incidentId: string;
  repairAttemptId: string;
  approvedAt: string;
  approvalSource: 'human_api' | 'cli';
  patchHash: string;
  approver: string;
}

// ── Snapshot (F2) ───────────────────────────────────────────────────────────

export interface SnapshotFileEntry {
  path: string;
  hash: string;  // SHA-256
}

export interface SnapshotManifest {
  incidentId: string;
  sourceHead: string;
  trackedModifiedFiles: SnapshotFileEntry[];
  untrackedIncludedFiles: SnapshotFileEntry[];
  worktreePath: string;
  verified: boolean;  // all hashes match between source and snapshot
  createdAt: string;
}

// ── Audit Log ───────────────────────────────────────────────────────────────

export interface AuditEntry {
  incidentId: string;
  fromState: IncidentStatus | null;
  toState: IncidentStatus;
  timestamp: string;
  actor: string;
  model?: string;
  provider?: string;
  artifactId?: string;
  reason: string;
}

// ── Evidence ────────────────────────────────────────────────────────────────

export interface EvidenceItem {
  type: 'log' | 'health' | 'process' | 'file' | 'diff' | 'config' | 'runtime' | 'test' | 'screenshot' | 'trace';
  label: string;
  content: string;  // bounded, max ~5KB per item
  source: string;
  timestamp: string;
}

/** F6: Evidence package separates facts from hypotheses */
export interface EvidencePackage {
  observedFacts: EvidenceItem[];
  hypotheses: { hypothesis: string; source: string }[];
  totalSizeBytes: number;
  collectedAt: string;
}

// ── Test Results (F7) ───────────────────────────────────────────────────────

export type TestVerdict = 'PASS' | 'FAIL' | 'BLOCKED_BY_BASELINE_FAILURE' | 'PASS_WITH_BASELINE_FAILURES';

export interface TestResult {
  name: string;
  command: string;
  exitCode: number;
  stdout: string;   // truncated to 2KB
  stderr: string;   // truncated to 2KB
  durationMs: number;
  passed: boolean;
}

export interface BaselineComparison {
  baselineErrors: string[];
  postPatchErrors: string[];
  newErrors: string[];
  fixedErrors: string[];
  verdict: TestVerdict;
}

export interface TestReport {
  results: TestResult[];
  baseline: BaselineComparison;
  overallVerdict: TestVerdict;
}

// ── Repair Steps ────────────────────────────────────────────────────────────

export interface RepairStep {
  order: number;
  action: string;
  target: string;
  description: string;
  rationale: string;
}

// ── Diagnosis (F6: ranked candidate causes) ─────────────────────────────────

export interface CandidateCause {
  cause: string;
  supportingEvidence: string[];
  contradictingEvidence: string[];
  confidence: number;
}

export interface AstraDiagnosis {
  diagnosisId: string;
  incidentId: string;
  modelIdentity: ModelIdentityRecord;
  failureDomain: FailureDomain;
  rootCause: string;
  confidence: number;
  candidateCauses: CandidateCause[];
  selectedRootCause: string;
  evidence: EvidenceItem[];
  affectedFiles: string[];
  repairStrategy: string;
  repairSteps: RepairStep[];
  testsRequired: string[];
  riskLevel: RiskLevel;
  rollbackPlan: string;
  requiresHumanApproval: boolean;
  status: 'confirmed' | 'needs_more_evidence' | 'inconclusive';
  createdAt: string;
}

// ── Incidents ───────────────────────────────────────────────────────────────

export interface RepairIncident {
  incidentId: string;
  status: IncidentStatus;
  component: string;
  failureDomain: FailureDomain;
  symptom: string;
  detectedAt: string;
  resolvedAt: string | null;
  triggeredBy: 'automatic' | 'manual' | 'user_command';
  priority: 'low' | 'medium' | 'high' | 'critical';
  metadata: Record<string, unknown>;
}

// ── Repair Attempts ─────────────────────────────────────────────────────────

export interface RepairAttempt {
  attemptId: string;
  incidentId: string;
  diagnosisId: string;
  worktreePath: string;
  diffSummary: string;
  fullDiff: string;
  filesChanged: string[];
  testReport: TestReport;
  argusVerdict: 'approve' | 'reject' | 'more_testing' | 'pending';
  argusEvidence: string;
  argusModelIdentity?: ModelIdentityRecord;
  status: 'in_progress' | 'tested' | 'verified' | 'approved' | 'deployed' | 'rejected' | 'rolled_back';
  createdAt: string;
  completedAt: string | null;
}

// ── Budget ──────────────────────────────────────────────────────────────────

export interface RepairBudget {
  maxAstraCalls: number;
  maxCodexAttempts: number;
  maxArgusVerifications: number;
  maxTotalDurationMs: number;
  maxModifiedFiles: number;
  astraCallsUsed: number;
  codexAttemptsUsed: number;
  argusVerificationsUsed: number;
  startedAt: string;
}

export interface RepairDeployment {
  deploymentId: string;
  incidentId: string;
  attemptId: string;
  buildId: string;
  previousBuildId: string;
  deployedAt: string;
  rolledBackAt: string | null;
  status: 'deployed' | 'rolled_back' | 'verified';
}

export const DEFAULT_REPAIR_BUDGET: Omit<RepairBudget, 'astraCallsUsed' | 'codexAttemptsUsed' | 'argusVerificationsUsed' | 'startedAt'> = {
  maxAstraCalls: 3,
  maxCodexAttempts: 2,
  maxArgusVerifications: 2,
  maxTotalDurationMs: 15 * 60 * 1000,
  maxModifiedFiles: 10,
};
