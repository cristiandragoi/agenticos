/**
 * domains/codingRuntime/types.ts — canonical, provider-neutral coding runtime
 * contract (Phase 2).
 *
 * Agentic OS owns the run. The coding worker (Codex Builder) executes inside
 * an isolated git worktree. Provider details are hidden behind the
 * CodexRuntimeAdapter — no CLI process details leak to the rest of the app.
 */

export type CodingRunStatus =
  | 'queued'
  | 'preparing_workspace'
  | 'running'
  | 'retrying'
  | 'switching_provider'
  | 'verifying'
  | 'awaiting_review'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type CodingProviderPolicyId = 'default' | 'economy' | 'quality';

export type CodingFailureClass =
  | 'PROVIDER_TRANSIENT'
  | 'PROVIDER_AUTH'
  | 'MODEL_UNAVAILABLE'
  | 'TASK_FAILURE'
  | 'SAFETY_BLOCK'
  | 'CANCELLED'
  | 'TIME_BUDGET_EXCEEDED'
  | 'UNKNOWN';

export interface CodingProviderPolicy {
  policyId: CodingProviderPolicyId;
  primary: string;             // verified provider name (gateway name)
  fallback: string[];          // V1: max one verified fallback
  maxAttemptsPerProvider: number; // V1: 1
  maxTotalAttempts: number;    // bounded total
  maxFallbacks: number;        // V1: 1
}

export interface CodingRunRequest {
  taskId: string;
  projectId: string;
  projectTaskId: string;
  backgroundTaskId?: string;
  executionRunId?: string;
  workspace: string;                 // parent repository path (protected)
  branch?: string;                   // base branch to branch from
  instructions: string;              // the coding task
  acceptanceCriteria?: string;
  providerPolicy: CodingProviderPolicy;
  allowedCommands?: string[];
  networkPolicy?: 'none' | 'local' | 'limited' | 'full'; // V1: 'local'
  approvalPolicy?: 'auto' | 'manual';
  timeoutMs?: number;
  sandboxMode?: 'read-only' | 'workspace-write' | 'danger-full-access'; // V1: workspace-write
  conversationId?: string;
  /** Phase 12 spike overrides — provider-specific wire config. */
  spike?: {
    deepseekBaseUrl?: string;
    deepseekModel?: string;
    /**
     * Deterministic live-fallback test hook: force an ELIGIBLE transient
     * provider failure for the named provider (PROVIDER_TRANSIENT) so the
     * A→B fallback path can be proven live without a real outage. Never
     * used for auth/safety/cancel/coding failures.
     */
    forceProviderFailure?: {
      provider: string;
      reason?: string;
    };
  };
}

export interface CodingCommandRecord {
  command: string;
  cwd: string;
  startedAt: string;
  endedAt?: string;
  exitCode?: number | null;
  outputRef?: string;   // bounded artifact reference
  outputPreview?: string; // bounded preview, redacted
  provider: string;
  model: string;
  runId: string;
  highRisk?: boolean;
}

export interface CodingCheckpoint {
  phase:
    | 'workspace_created'
    | 'repository_inspected'
    | 'implementation_started'
    | 'files_changed'
    | 'build_attempted'
    | 'tests_attempted'
    | 'provider_failure'
    | 'fallback_initiated'
    | 'verification_started'
    | 'awaiting_review';
  timestamp: string;
  detail?: Record<string, unknown>;
}

export interface CodingProviderAttempt {
  attempt: number;
  provider: string;
  model: string;
  startedAt: string;
  endedAt?: string;
  outcome: 'running' | 'succeeded' | 'failed' | 'cancelled';
  failureClass?: CodingFailureClass;
  failureReason?: string;
}

export interface CodingRun {
  runId: string;
  taskId: string;
  projectId: string;
  projectTaskId: string;
  backgroundTaskId?: string;
  executionRunId?: string;
  status: CodingRunStatus;
  runtime: 'codex_builder';
  providerPolicyId: CodingProviderPolicyId;
  workspace: string;         // parent repo (protected)
  worktreePath?: string;     // isolated worktree
  branch?: string;
  baseCommit?: string;
  baseBranch?: string;
  created: string;
  updated: string;
  startedAt?: string;
  endedAt?: string;
  instructions: string;
  acceptanceCriteria?: string;
  packetHash?: string;       // task packet version/hash
  changedFiles: string[];
  commands: CodingCommandRecord[];
  testResults?: {
    requested: string[];
    ran: string[];
    passed: number;
    failed: number;
    skipped: number;
    buildOk: boolean;
    rawRefs: string[];
  };
  artifacts: string[];
  diffRef?: string;
  diffSummary?: string;
  verifierVerdict?: 'PASS' | 'NEEDS_REVISION' | 'FAIL' | 'NOT_PROVEN';
  verifierProvenance?: string;
  providerAttempts: CodingProviderAttempt[];
  fallbackHistory: { from: string; to: string; reason: string; at: string; handoffRef?: string }[];
  checkpoints: CodingCheckpoint[];
  errors: { phase: string; message: string; at: string }[];
  cancellationReason?: string;
  reviewState?: 'awaiting_review' | 'approved' | 'changes_requested' | 'discarded';
  reviewFeedback?: string;
  metadata: Record<string, unknown>;
}

/** Compact state-preserving fallback handoff (Phase 15). Never contains secrets. */
export interface CodingFallbackHandoff {
  runId: string;
  taskId: string;
  projectId: string;
  workspacePath: string;
  baseCommit: string;
  currentBranch: string;
  provider: string;
  model: string;
  failureReason: string;
  failureClass: CodingFailureClass;
  completedSteps: string[];
  remainingAcceptanceCriteria: string[];
  filesChanged: string[];
  diffSummary: string;
  commandsRun: CodingCommandRecord[];
  testsPassed: string[];
  testsFailing: string[];
  knownErrors: string[];
  nextRecommendedAction: string;
  handoffAt: string;
}
