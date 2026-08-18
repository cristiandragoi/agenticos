/**
 * evaluation/types.ts — normalized model-evaluation contract (Part C).
 *
 * Provider-agnostic: any provider registered with the gateway can be
 * evaluated. Records are persisted separately from project memory.
 */

export type EvalOutcome = 'PASS' | 'NEEDS_REVISION' | 'FAIL' | 'ERROR' | 'TIMEOUT' | 'CANCELLED' | 'SKIPPED';

export type EvalCategory =
  | 'direct_factual'
  | 'architecture_reasoning'
  | 'coding_reasoning'
  | 'structured_json'
  | 'tool_selection'
  | 'browser_planning'
  | 'current_work_synthesis'
  | 'long_context';

export interface EvalAssertion {
  /** Kind of deterministic check. */
  kind: 'contains' | 'not_contains' | 'exact_field' | 'valid_json' | 'tool_selected' | 'url_title' | 'forbidden_hallucination';
  /** Argument(s) for the check, e.g. expected substring / field name / value. */
  value: string;
  /** Human-readable description used in reports. */
  description: string;
}

export interface EvalCase {
  id: string;
  category: EvalCategory;
  prompt: string;
  /** System/context prompt. */
  systemPrompt?: string;
  /** Context (e.g. runtime current-work snapshot) supplied to the model. */
  context?: string;
  /** Allowed tools for tool-selection cases. */
  allowedTools?: string[];
  /** Assertions; the case PASSes when ALL pass (deterministic). */
  assertions: EvalAssertion[];
  /** Timeout per run in ms. */
  timeoutMs?: number;
  /** Expected JSON schema name (for structured_json cases). */
  jsonSchema?: string;
  /** Larger synthetic context for long-context cases. */
  longContext?: string;
  /** Max tokens for the run. */
  maxTokens?: number;
}

export interface EvalRunResult {
  caseId: string;
  provider: string;
  model: string;
  outcome: EvalOutcome;
  output: string;
  /** Per-assertion results. */
  assertions: { description: string; passed: boolean; detail?: string }[];
  /** Latency in ms (full completion). */
  latencyMs: number;
  /** First-token latency in ms (0 when unknown / non-streamed). */
  firstTokenMs: number;
  totalTokens?: number;
  promptTokens?: number;
  completionTokens?: number;
  toolCallCount: number;
  toolErrors: number;
  structuredOutputValid: boolean;
  /** Reason for non-PASS outcomes. */
  error?: string;
  /** Verifier provenance. */
  verifier: 'deterministic_assertions' | 'verification_service' | 'none';
  startedAt: string;
  completedAt: string;
}

export interface EvalComparisonEntry {
  caseId: string;
  provider: string;
  model: string;
  outcome: EvalOutcome;
  latencyMs: number;
  firstTokenMs: number;
  totalTokens?: number;
}

export interface EvalComparison {
  caseId: string;
  entries: EvalComparisonEntry[];
  recommended?: string;
  recommendationReason?: string;
}
