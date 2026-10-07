/**
 * semanticIntentArbitrator.ts — Authoritative Single-Pass Semantic Intent Arbitrator
 *
 * Re-exports from AuthoritativeIntentCompiler and TurnEnvelope for Phase 1 compatibility.
 */

export {
  AuthoritativeIntentCompiler,
  arbitrateSemanticIntent,
  normalizeEntityNames,
  type CompiledAction as SemanticAction,
  type CompiledTargetType as SemanticTargetType,
  type CompiledTurnIntent as SemanticTurnIntent,
  type IntentCompilerContext as ArbitratorContext,
  type CompiledAction,
  type CompiledTargetType,
  type CompiledTurnIntent,
  type IntentCompilerContext,
} from '../controlPlane/AuthoritativeIntentCompiler.js';

export {
  createTurnEnvelope,
  logTurnEnvelope,
  assertIntentCompatibility,
  recordIntentOverrideAttempt,
  getIntentOverrideAttemptsCount,
  getIntentOverrideLog,
  resetIntentOverrideAttempts,
  type TurnEnvelope,
  type TurnSource,
  type CreateTurnEnvelopeParams,
} from '../controlPlane/TurnEnvelope.js';
