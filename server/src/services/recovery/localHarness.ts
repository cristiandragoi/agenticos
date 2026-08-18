/**
 * LocalHarness V1 — bounded local recovery coordinator.
 *
 * Composes EXISTING infrastructure only (P0): background task manager,
 * GateRunner, RuntimePolicy/PrivacyPolicy, HardwareProfiler, gateway
 * routing. It does NOT contain another gateway/runner/router/store.
 *
 * Hard invariants enforced here:
 *   A. required gates cannot be bypassed (gate failures only ever lead to
 *      rework → re-verification, never completion)
 *   B. privacy policy cannot be bypassed (cloud escalation requires
 *      mayLeaveMachine(policy) === true; otherwise blocked_by_policy)
 *   C. human approval stops autonomous recovery
 *   D. cancellation dominates
 *   E. every branch is bounded by RecoveryPolicy budgets
 *   F. assigned/effective model truth is preserved in every decision
 */
import {
  type RecoveryPolicy, type RecoveryDecision, type RecoveryDecisionKind,
  type RecoveryBudgetUsage, budgetExceeded, DEFAULT_RECOVERY_POLICY,
} from './policy.js';
import {
  type FailureClass, type FailureClassification, classifyFailure, errorString,
} from './classifier.js';
import type { ProjectPolicy } from '../policy/policyService.js';
import { mayLeaveMachine } from '../policy/policyService.js';
import type { CapabilityTier } from '../system/hardwareProfiler.js';

export interface LocalHarnessContext {
  policy?: RecoveryPolicy;
  projectPolicy?: ProjectPolicy | null;
  /** Authoritative local model inventory (hardwareProfiler.ollama.models). */
  localModels?: Array<{ id: string; size?: number | null }>;
  hardwareTier?: CapabilityTier;
  assignedProvider?: string | null;
  assignedModel?: string | null;
  used: RecoveryBudgetUsage;
  taskStatus?: string | null;
  cancellationRequested?: boolean;
  /** Gate evidence from a failed required gate (for rework). */
  gateEvidence?: { gateId: string; reason: string; attempt: number } | null;
}

export interface ClassifyAndDecideResult {
  classification: FailureClassification;
  decision: RecoveryDecision;
}

function blocked(reason: string, opts: Partial<RecoveryDecision> = {}): RecoveryDecision {
  return { kind: 'blocked', reason, escalationOccurred: false, budgetRemaining: false, ...opts };
}

function dec(kind: RecoveryDecisionKind, reason: string, opts: Partial<RecoveryDecision> = {}): RecoveryDecision {
  return { kind, reason, escalationOccurred: false, budgetRemaining: true, ...opts };
}

/** Advisory "stronger local model" picker — never pretends certainty.
 *  Unknown hardware/model capability → returns null (skip that escalation). */
export function pickStrongerLocalModel(
  assignedModel: string | null | undefined,
  localModels: Array<{ id: string; size?: number | null }> | undefined,
  tier: CapabilityTier | undefined,
): { id: string } | null {
  if (!localModels || localModels.length === 0 || !assignedModel) return null;
  // Cloud-link placeholders are NOT local — never chosen as local escalation.
  const local = localModels.filter((m) => !/:cloud|cloud-link/i.test(m.id));
  if (local.length === 0) return null;

  const paramOf = (id: string): number | null => {
    const m = /(\d+(?:\.\d+)?)\s*b/i.exec(id);
    return m ? parseFloat(m[1]) : null;
  };
  const assignedSize = paramOf(assignedModel);

  let candidates = local;
  if (assignedSize !== null) {
    candidates = local.filter((m) => {
      const s = paramOf(m.id);
      return s !== null && s > assignedSize;
    });
  } else {
    // No size signal for the assigned model — only escalate to a model with
    // a clear size signal (advisory; uncertain stays unknown → null).
    candidates = local.filter((m) => paramOf(m.id) !== null);
  }
  if (candidates.length === 0) return null;

  // Conservative tier guard: on lite/unknown tiers, refuse large candidates
  // (unknown capability must remain unknown — the harness skips rather than
  // pretend a model will run).
  const sorted = [...candidates].sort((a, b) => (paramOf(a.id) ?? 0) - (paramOf(b.id) ?? 0));
  const chosen = sorted[0];
  const size = paramOf(chosen.id) ?? 0;
  if ((tier === 'lite' || tier === 'unknown') && size > 8) return null;
  return { id: chosen.id };
}

/**
 * Classify a failure and produce the single next recovery decision,
 * strictly within policy + privacy bounds.
 */
export function classifyAndDecide(err: unknown, ctx: LocalHarnessContext): ClassifyAndDecideResult {
  const policy = ctx.policy ?? DEFAULT_RECOVERY_POLICY;
  // Forward STRUCTURED context to the classifier — never classify from the
  // message text alone when the error carries code/status markers.
  const code = (err && typeof err === 'object' && (err as any).code) as string | undefined;
  const status = (err && typeof err === 'object' && (err as any).status) as number | undefined;
  const classification = classifyFailure(err, {
    code,
    status,
    cancelled: ctx.cancellationRequested,
    approvalPending: ctx.taskStatus === 'waiting_approval' || code === 'APPROVAL_REQUIRED',
    gateFailed: ctx.gateEvidence != null || code === 'GATE_FAILURE',
    policyBlocked: code === 'POLICY_BLOCKED',
  });
  const used = ctx.used;

  const makeEscalationDecision = (): RecoveryDecision => {
    // Local escalation first (P15 order): stronger permitted LOCAL model.
    if (policy.allowStrongerLocalModel) {
      const stronger = pickStrongerLocalModel(ctx.assignedModel, ctx.localModels, ctx.hardwareTier);
      if (stronger) {
        return dec('escalate_local_model', `MODEL_INADEQUATE: escalating to stronger local model ${stronger.id}`, {
          escalationOccurred: true,
          escalationReason: `local model escalation (attempt ${used.executionAttempts})`,
          previousProvider: ctx.assignedProvider ?? null,
          previousModel: ctx.assignedModel ?? null,
          effectiveProvider: 'ollama',
          effectiveModel: stronger.id,
          attempt: used.executionAttempts + 1,
        });
      }
    }

    // Cloud escalation ONLY if privacy/runtime policy permits (P4 hard gate).
    const cloudAllowed = policy.allowCloudEscalation && policy.requirePolicyCheckBeforeCloud
      && (!ctx.projectPolicy || mayLeaveMachine(ctx.projectPolicy));
    if (cloudAllowed) {
      return dec('escalate_cloud_model', 'MODEL_INADEQUATE: escalating to permitted cloud model', {
        escalationOccurred: true,
        escalationReason: `cloud escalation (attempt ${used.executionAttempts})`,
        previousProvider: ctx.assignedProvider ?? null,
        previousModel: ctx.assignedModel ?? null,
        effectiveProvider: 'cloud',
        effectiveModel: 'cloud-escalation',
        attempt: used.executionAttempts + 1,
      });
    }

    return blocked('POLICY_BLOCKED: cloud escalation forbidden by privacy/runtime policy', {
      blockedByPolicy: true, budgetRemaining: false,
    });
  };

  // Budgets first (E): never start a recovery step that cannot fit.
  const exceeded = budgetExceeded(policy, used);
  if (exceeded.exceeded) {
    return { classification, decision: blocked(exceeded.reason!, { budgetRemaining: false }) };
  }

  switch (classification.cls) {
    case 'CANCELLED':
      return { classification, decision: dec('cancelled', 'CANCELLED: recovery stops (cancellation dominates)') };

    case 'APPROVAL_REQUIRED':
      return { classification, decision: dec('wait_for_approval', 'APPROVAL_REQUIRED: autonomous recovery stops until explicit human approval', { budgetRemaining: true }) };

    case 'POLICY_BLOCKED':
      return { classification, decision: blocked('POLICY_BLOCKED: policy forbids the required action', { blockedByPolicy: true }) };

    case 'GATE_FAILURE': {
      if (used.gateReworkAttempts < policy.maxGateReworkAttempts) {
        const gateId = ctx.gateEvidence?.gateId ?? 'required-gate';
        return {
          classification,
          decision: dec('rework_after_gate_failure', `GATE_FAILURE: rework for gate ${gateId} (rework ${used.gateReworkAttempts + 1}/${policy.maxGateReworkAttempts})`, {
            attempt: used.executionAttempts + 1,
            effectiveProvider: ctx.assignedProvider ?? null,
            effectiveModel: ctx.assignedModel ?? null,
          }),
        };
      }
      return {
        classification,
        decision: blocked('RECOVERY_BUDGET_EXHAUSTED: gate rework attempts exhausted', { budgetRemaining: false }),
      };
    }

    case 'MODEL_INADEQUATE':
      return { classification, decision: makeEscalationDecision() };

    case 'RETRYABLE_EXECUTION': {
      if (policy.allowLocalRetry && used.sameModelRetries < policy.maxSameModelRetries) {
        return {
          classification,
          decision: dec('retry_same_model', `RETRYABLE_EXECUTION: retrying same model (retry ${used.sameModelRetries + 1}/${policy.maxSameModelRetries})`, {
            attempt: used.executionAttempts + 1,
            effectiveProvider: ctx.assignedProvider ?? null,
            effectiveModel: ctx.assignedModel ?? null,
          }),
        };
      }
      // Same-model retries exhausted → escalation path (policy-checked).
      return { classification, decision: makeEscalationDecision() };
    }

    case 'NON_RETRYABLE':
    default:
      return { classification, decision: blocked(`NON_RETRYABLE: ${classification.reason}`, { budgetRemaining: false }) };
  }
}

/** Build the next budget usage after a decision is taken. */
export function applyDecisionToBudget(used: RecoveryBudgetUsage, decision: RecoveryDecision): RecoveryBudgetUsage {
  const next = { ...used };
  if (decision.kind === 'retry_same_model') {
    next.sameModelRetries += 1;
    next.executionAttempts += 1;
  } else if (decision.kind === 'escalate_local_model' || decision.kind === 'escalate_cloud_model') {
    next.modelEscalations += 1;
    next.executionAttempts += 1;
  } else if (decision.kind === 'rework_after_gate_failure') {
    next.gateReworkAttempts += 1;
    next.executionAttempts += 1;
  }
  return next;
}

/** Short human-safe label for ACTIVE RUN / executionState (P12). */
export function recoveryStatusLabel(decision: RecoveryDecision): string {
  switch (decision.kind) {
    case 'retry_same_model': return `Retrying local model — attempt ${decision.attempt ?? '?'}`;
    case 'escalate_local_model': return `Escalating to stronger local model (${decision.effectiveModel ?? '?'})`;
    case 'escalate_cloud_model': return 'Escalating to permitted cloud model';
    case 'rework_after_gate_failure': return `Reworking after failed gate: ${decision.reason}`;
    case 'wait_for_approval': return 'Waiting for human approval';
    case 'blocked': return decision.blockedByPolicy ? 'Blocked by privacy policy' : 'Blocked';
    case 'cancelled': return 'Cancelled';
    case 'complete': return 'Completed';
    default: return 'Recovering';
  }
}

export { errorString };
