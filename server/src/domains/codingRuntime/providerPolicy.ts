/**
 * domains/codingRuntime/providerPolicy.ts — verified Codex provider policy
 * (Phase 13/33).
 *
 * V1 target: 1 primary + 1 verified fallback. A provider enters automatic
 * fallback ONLY after passing protocol compatibility, a basic coding POC,
 * cancellation, workspace safety, and a deterministic evaluation threshold.
 *
 * Current verified providers (2026-08-18):
 *  - openai (native Codex provider, gpt-5.5) — VERIFIED by live bounded run
 *    (codex exec --json succeeded, command execution + usage captured).
 *  - deepseek (Codex Responses wire via api.deepseek.com/v1, deepseek-chat)
 *    — VERIFIED by live bounded run (cr-msyfcbvo-ff8297): real apply_patch
 *    edits in an isolated worktree, node test.js exit 0, verifier PASS.
 *    Requires [windows] sandbox = "elevated" in the provider CODEX_HOME and a
 *    non-temp CODEX_HOME (Codex refuses helper binaries under system temp).
 */

import type { CodingProviderPolicy, CodingProviderPolicyId } from './types.js';

/** Providers that have passed the quality guard (P33). */
export const VERIFIED_CODEX_PROVIDERS: string[] = ['openai', 'deepseek'];

export const DEFAULT_CODING_POLICIES: Record<CodingProviderPolicyId, CodingProviderPolicy> = {
  default: {
    policyId: 'default',
    primary: 'openai',
    fallback: ['deepseek'], // verified fallback (P34: 1 primary + 1 verified)
    maxAttemptsPerProvider: 1,
    maxTotalAttempts: 2,
    maxFallbacks: 1,
  },
  economy: {
    policyId: 'economy',
    primary: 'openai',
    fallback: ['deepseek'],
    maxAttemptsPerProvider: 1,
    maxTotalAttempts: 2,
    maxFallbacks: 1,
  },
  quality: {
    policyId: 'quality',
    primary: 'openai',
    fallback: ['deepseek'],
    maxAttemptsPerProvider: 1,
    maxTotalAttempts: 2,
    maxFallbacks: 1,
  },
};

/** DeepSeek spike policy — used ONLY for the explicit wire-compatibility POC
 *  (Phase 12), never for automatic fallback. */
export const DEEPSEEK_SPIKE_POLICY: CodingProviderPolicy = {
  policyId: 'default',
  primary: 'deepseek',
  fallback: [],
  maxAttemptsPerProvider: 1,
  maxTotalAttempts: 1,
  maxFallbacks: 0,
};

export function getCodingPolicy(policyId?: CodingProviderPolicyId): CodingProviderPolicy {
  return DEFAULT_CODING_POLICIES[policyId || 'default'] ?? DEFAULT_CODING_POLICIES.default;
}

/** Provider is approved for Codex coding use (automatic fallback eligibility). */
export function isVerifiedCodexProvider(provider: string): boolean {
  return VERIFIED_CODEX_PROVIDERS.some((p) => p.toLowerCase() === provider.toLowerCase());
}
