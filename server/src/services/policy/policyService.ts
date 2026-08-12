/**
 * PolicyService V1 (Stage 2) — project privacy + runtime execution policy.
 *
 * Explicit policy boundaries that EXTEND the existing execution/routing
 * architecture (no gateway replacement, no second router, no second approval
 * system). V1 is explicit project/task policy only — NO automatic content
 * classification.
 *
 * Priority order (never violated):
 *   privacy policy  >  explicit runtime restriction  >  hardware capability
 *   >  quality/cost/latency preference
 * A weak machine NEVER justifies violating localOnly.
 */

export type PrivacyLevel = 'public' | 'internal' | 'sensitive' | 'secret';
export type RuntimeMode = 'auto' | 'localPreferred' | 'localOnly' | 'cloudPreferred';
export type CloudEscalationPolicy = 'allowed' | 'approvalRequired' | 'forbidden';

export interface ProjectPolicy {
  privacy: PrivacyLevel;
  runtime: RuntimeMode;
  cloudEscalation: CloudEscalationPolicy;
}

export const DEFAULT_POLICY: ProjectPolicy = {
  privacy: 'internal',
  runtime: 'auto',
  cloudEscalation: 'allowed',
};

const PRIVACY_LEVELS: PrivacyLevel[] = ['public', 'internal', 'sensitive', 'secret'];
const RUNTIME_MODES: RuntimeMode[] = ['auto', 'localPreferred', 'localOnly', 'cloudPreferred'];
const ESCALATION_MODES: CloudEscalationPolicy[] = ['allowed', 'approvalRequired', 'forbidden'];

/** Validate + normalize an untrusted policy object. Throws on invalid input
 *  (routers map to 400). Contradictory combinations are rejected. */
export function validatePolicy(input: unknown): ProjectPolicy {
  if (input == null || typeof input !== 'object') {
    throw new Error('policy must be an object');
  }
  const p = input as Record<string, unknown>;
  const privacy = p.privacy as PrivacyLevel;
  const runtime = p.runtime as RuntimeMode;
  const cloudEscalation = p.cloudEscalation as CloudEscalationPolicy;
  if (!PRIVACY_LEVELS.includes(privacy)) throw new Error(`privacy must be one of ${PRIVACY_LEVELS.join(', ')}`);
  if (!RUNTIME_MODES.includes(runtime)) throw new Error(`runtime must be one of ${RUNTIME_MODES.join(', ')}`);
  if (!ESCALATION_MODES.includes(cloudEscalation)) throw new Error(`cloudEscalation must be one of ${ESCALATION_MODES.join(', ')}`);
  // Contradictory combinations:
  if (runtime === 'localOnly' && cloudEscalation === 'allowed') {
    throw new Error('runtime=localOnly contradicts cloudEscalation=allowed (use approvalRequired or forbidden)');
  }
  if (runtime === 'cloudPreferred' && privacy === 'secret') {
    throw new Error('privacy=secret contradicts runtime=cloudPreferred');
  }
  return { privacy, runtime, cloudEscalation };
}

/** Parse a stored policy value, falling back to the safe default. Never
 *  throws: corrupted/missing policy = default policy. */
export function parsePolicy(stored: unknown): ProjectPolicy {
  try {
    if (stored == null) return { ...DEFAULT_POLICY };
    if (typeof stored === 'string') return validatePolicy(JSON.parse(stored));
    return validatePolicy(stored);
  } catch {
    return { ...DEFAULT_POLICY };
  }
}

/** May this task's content leave the machine at all? */
export function mayLeaveMachine(policy: ProjectPolicy): boolean {
  return policy.privacy === 'public' || policy.privacy === 'internal';
}

/** Is local execution preferred (or mandatory)? */
export function localPreferred(policy: ProjectPolicy): boolean {
  return policy.runtime === 'localOnly' || policy.runtime === 'localPreferred';
}

// ── Escalation decision ─────────────────────────────────────────────────────

export interface EscalationDecision {
  action: 'allow' | 'approve-first' | 'block';
  reason: string;
}

/**
 * Decide whether a local failure may escalate to cloud. This is THE gate
 * that localOnly / approvalRequired policies enforce — it answers the
 * question BEFORE any prompt content is sent anywhere.
 */
export function decideEscalation(policy: ProjectPolicy): EscalationDecision {
  if (policy.runtime === 'localOnly') {
    return { action: 'block', reason: 'runtime policy is localOnly — local failure must not escalate to cloud' };
  }
  if (!mayLeaveMachine(policy)) {
    return { action: 'block', reason: `privacy policy ${policy.privacy} forbids sending content to cloud providers` };
  }
  if (policy.cloudEscalation === 'forbidden') {
    return { action: 'block', reason: 'cloudEscalation is forbidden by policy' };
  }
  if (policy.cloudEscalation === 'approvalRequired') {
    return { action: 'approve-first', reason: 'cloud escalation requires explicit human approval (policy)' };
  }
  return { action: 'allow', reason: 'cloud escalation allowed by policy' };
}

/**
 * Should the request even TRY a cloud provider first? (routing preference)
 * Hardware capability never overrides privacy: a weak machine + localOnly
 * stays local (or fails/needs human action), per the priority order.
 */
export function shouldPreferCloud(policy: ProjectPolicy): boolean {
  if (!mayLeaveMachine(policy)) return false;
  if (policy.runtime === 'localOnly' || policy.runtime === 'localPreferred') return false;
  return policy.runtime === 'cloudPreferred';
}

/**
 * Is a provider allowed for this policy? Ollama (local) is always allowed.
 * Cloud providers require mayLeaveMachine. Explicitly-allowed providers in a
 * future per-policy allowlist hook in here (V1: all declared cloud providers
 * are allowed when content may leave).
 */
export function isProviderAllowed(policy: ProjectPolicy, providerId: string): boolean {
  if (providerId === 'prov-ollama' || providerId === 'ollama') return true;
  return mayLeaveMachine(policy);
}

/**
 * Build the runtime restriction flags a ChatRequest needs to honor policy:
 * - localOnly: no fallback to cloud, no escalation
 * - approvalRequired escalation: escalation withheld until approved
 *   (caller passes approved=true after human approval; V1 withholds it).
 */
export function chatPolicyFlags(
  policy: ProjectPolicy,
  opts: { escalationApproved?: boolean } = {},
): { disableFallback: boolean; allowEscalation: boolean } {
  const decision = decideEscalation(policy);
  const allowEscalation =
    decision.action === 'allow' || (decision.action === 'approve-first' && opts.escalationApproved === true);
  const disableFallback = policy.runtime === 'localOnly' || !mayLeaveMachine(policy);
  return { disableFallback, allowEscalation };
}
