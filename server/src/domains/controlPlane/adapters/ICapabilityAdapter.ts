/**
 * ICapabilityAdapter.ts — Authoritative Capability Adapter Contract
 *
 * PHASE 5 CONTROL-PLANE COMPONENT
 *
 * Every capability adapter must conform to ONE unified contract:
 * - resolveTarget()
 * - execute()
 * - verify()
 * - acquireContent()
 *
 * All adapters return the same typed results.
 */

import type { CompiledTurnIntent } from '../AuthoritativeIntentCompiler.js';
import type { AuthoritativeInteractionContextData } from '../AuthoritativeInteractionContext.js';
import type { ExecutionStepResult } from '../VerificationGateway.js';
import type { ResolvedTargetEvidence } from '../TargetResolver.js';
import type { UniversalAcquisitionResult } from '../UniversalContentAcquisition.js';

export interface ICapabilityAdapter {
  readonly id: string;
  readonly supportedActions: readonly string[];

  /**
   * Resolves the exact target given structured intent and context.
   */
  resolveTarget(
    intent: CompiledTurnIntent,
    context: AuthoritativeInteractionContextData
  ): Promise<ResolvedTargetEvidence>;

  /**
   * Executes the capability against the resolved target.
   */
  execute(
    intent: CompiledTurnIntent,
    stepId: string | number,
    conversationId: string,
    resolvedTarget?: ResolvedTargetEvidence
  ): Promise<ExecutionStepResult>;

  /**
   * Verifies the execution outcome against expected target evidence.
   */
  verify(
    executionResult: ExecutionStepResult,
    expectedTarget: ResolvedTargetEvidence
  ): Promise<{ isVerified: boolean; reason: string }>;

  /**
   * Acquires structured content from the verified target.
   */
  acquireContent(
    intent: CompiledTurnIntent,
    resolvedTarget: ResolvedTargetEvidence,
    conversationId: string
  ): Promise<UniversalAcquisitionResult>;
}
