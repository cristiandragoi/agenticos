/**
 * RecoveryPolicy V1 — bounded autonomous recovery contract.
 *
 * Reuses existing AgenticOS infrastructure (background tasks, GateRunner,
 * RuntimePolicy/PrivacyPolicy, HardwareProfiler, gateway routing). This is
 * NOT a new task store / run store / gate framework / router — it is the
 * bounded decision layer that composes them.
 *
 * Hard invariants (P4/P8/P9/P10):
 *   - recovery NEVER overrides privacy policy (requirePolicyCheckBeforeCloud
 *     is always true in v1)
 *   - human approval always stops autonomous recovery for that branch
 *   - cancellation always dominates recovery
 *   - every loop is bounded by explicit budgets — no unbounded retry
 */
export interface RecoveryPolicy {
  /** Total execution attempts allowed (including the first). */
  maxExecutionAttempts: number;
  /** Corrective/rework cycles after a required-gate failure. */
  maxGateReworkAttempts: number;
  /** Retries with the SAME model before any escalation. */
  maxSameModelRetries: number;
  /** Distinct model escalation steps (local/cloud). */
  maxModelEscalations: number;
  /** Wall-clock budget for the whole recovery lifecycle. */
  maxTotalDurationMs: number;

  allowLocalRetry: boolean;
  allowStrongerLocalModel: boolean;
  allowCloudEscalation: boolean;
  /** Always true in v1 — privacy is checked before ANY cloud escalation. */
  requirePolicyCheckBeforeCloud: boolean;
  /** Always true in v1 — cancellation dominates. */
  stopOnCancellation: boolean;
  /** Always true in v1 — human approval stops autonomous recovery. */
  stopOnHumanApproval: boolean;
}

export const DEFAULT_RECOVERY_POLICY: RecoveryPolicy = {
  maxExecutionAttempts: 3,
  maxGateReworkAttempts: 2,
  maxSameModelRetries: 2,
  maxModelEscalations: 1,
  maxTotalDurationMs: 30 * 60 * 1000,
  allowLocalRetry: true,
  allowStrongerLocalModel: true,
  allowCloudEscalation: true,
  requirePolicyCheckBeforeCloud: true,
  stopOnCancellation: true,
  stopOnHumanApproval: true,
};

export type RecoveryDecisionKind =
  | 'retry_same_model'
  | 'retry_with_adjusted_context'
  | 'escalate_local_model'
  | 'escalate_cloud_model'
  | 'rework_after_gate_failure'
  | 'wait_for_approval'
  | 'blocked'
  | 'cancelled'
  | 'complete';

export interface RecoveryDecision {
  kind: RecoveryDecisionKind;
  /** Machine-readable reason (never hidden chain-of-thought). */
  reason: string;
  /** Next execution attempt number (1-based). */
  attempt?: number;
  effectiveProvider?: string | null;
  effectiveModel?: string | null;
  previousProvider?: string | null;
  previousModel?: string | null;
  escalationOccurred: boolean;
  escalationReason?: string;
  budgetRemaining: boolean;
  blockedByPolicy?: boolean;
}

export interface RecoveryBudgetUsage {
  executionAttempts: number;
  gateReworkAttempts: number;
  sameModelRetries: number;
  modelEscalations: number;
  startedAtMs: number;
}

export function newBudgetUsage(nowMs: number = Date.now()): RecoveryBudgetUsage {
  return {
    executionAttempts: 1, // the first attempt already happened
    gateReworkAttempts: 0,
    sameModelRetries: 0,
    modelEscalations: 0,
    startedAtMs: nowMs,
  };
}

/** True when ANY budget limit is hit; returns the first reason.
 *  Note: sameModelRetries is a BRANCH sub-limit (gates the retry decision),
 *  not a global recovery budget — it must not block escalation. */
export function budgetExceeded(policy: RecoveryPolicy, used: RecoveryBudgetUsage):
  { exceeded: boolean; reason?: string } {
  if (used.executionAttempts >= policy.maxExecutionAttempts) {
    return { exceeded: true, reason: `RECOVERY_BUDGET_EXHAUSTED: max execution attempts (${policy.maxExecutionAttempts})` };
  }
  if (used.gateReworkAttempts >= policy.maxGateReworkAttempts) {
    return { exceeded: true, reason: `RECOVERY_BUDGET_EXHAUSTED: max gate rework attempts (${policy.maxGateReworkAttempts})` };
  }
  if (used.modelEscalations >= policy.maxModelEscalations) {
    return { exceeded: true, reason: `RECOVERY_BUDGET_EXHAUSTED: max model escalations (${policy.maxModelEscalations})` };
  }
  if (Date.now() - used.startedAtMs >= policy.maxTotalDurationMs) {
    return { exceeded: true, reason: `RECOVERY_BUDGET_EXHAUSTED: max duration (${policy.maxTotalDurationMs}ms)` };
  }
  return { exceeded: false };
}
