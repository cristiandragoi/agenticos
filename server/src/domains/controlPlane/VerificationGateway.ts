/**
 * VerificationGateway.ts — Authoritative Verification Gateway
 *
 * PHASE 3 CONTROL-PLANE COMPONENT
 *
 * Guarantees:
 * 1. Every capability execution returns a strongly typed ExecutionStepResult:
 *    { stepId, action, requestedTarget, executedTarget, success, verified, verificationEvidence, failureReason, artifacts, contextMutation }
 * 2. A step is considered successful ONLY when:
 *    success === true AND verified === true.
 * 3. NO OPTIMISTIC UPDATES: if verification fails, verified is false and failureReason is populated.
 * 4. Context mutation is strictly validated before being committed to AuthoritativeInteractionContext.
 */

import { logger } from '../../utils/logger.js';
import type { VerifiedOutcomeInput } from './AuthoritativeInteractionContext.js';

export interface VerificationEvidence {
  source: 'process_table' | 'window_inspection' | 'uia' | 'cdp' | 'dom' | 'vision' | 'task_registry' | 'conversation' | 'authoritative_desktop_provider' | 'media_generator';
  label: string;
  observedAt: number;
  data: Record<string, unknown>;
  targetIdentity?: any;
}

export interface ExecutionStepResult {
  readonly stepId: string | number;
  readonly action: string;
  readonly requestedTarget?: string | null;
  readonly executedTarget?: string | null;
  readonly success: boolean;
  readonly verified: boolean;
  readonly verificationEvidence?: VerificationEvidence | null;
  readonly failureReason?: string;
  readonly artifacts?: readonly string[];
  readonly contextMutation?: Readonly<VerifiedOutcomeInput>;
  readonly outputText?: string;
}

export class VerificationGateway {
  private static instance: VerificationGateway;

  private constructor() {}

  public static getInstance(): VerificationGateway {
    if (!VerificationGateway.instance) {
      VerificationGateway.instance = new VerificationGateway();
    }
    return VerificationGateway.instance;
  }

  /**
   * Asserts whether a capability result meets the strict verification contract.
   * A step is acceptable ONLY if success === true AND verified === true.
   */
  public evaluate(result: ExecutionStepResult): { isVerifiedSuccess: boolean; reason: string } {
    // 1. Must be marked success and verified
    if (!result.success) {
      const reason = result.failureReason || `Step '${result.action}' execution failed.`;
      logger.warn('[VerificationGateway] Execution failure:', { action: result.action, reason });
      return { isVerifiedSuccess: false, reason };
    }

    if (!result.verified) {
      const reason = result.failureReason || `Step '${result.action}' reported success but post-condition verification failed.`;
      logger.warn('[VerificationGateway] Verification failure (optimistic attempt rejected):', { action: result.action, reason });
      return { isVerifiedSuccess: false, reason };
    }

    const evidence = result.verificationEvidence;

    // 2. Production VerificationGateway MUST reject source = mock
    const isMock = evidence?.source === ('mock' as any) ||
      (result as any).mock === true ||
      (result as any).isMock === true ||
      evidence?.data?.isMock === true ||
      evidence?.data?.mock === true;
    if (isMock) {
      const reason = `Step '${result.action}' rejected: mock verification evidence is prohibited in production execution.`;
      logger.warn('[VerificationGateway] Verification rejected (mock source detected):', { action: result.action });
      return { isVerifiedSuccess: false, reason };
    }

    // 3. Production VerificationGateway MUST reject synthetic = true
    const isSynthetic = evidence?.data?.synthetic === true ||
      (result as any).synthetic === true ||
      evidence?.data?.isSynthetic === true ||
      (result as any).isSynthetic === true;
    if (isSynthetic) {
      const reason = `Step '${result.action}' rejected: synthetic data detected in verification evidence.`;
      logger.warn('[VerificationGateway] Verification rejected (synthetic data detected):', { action: result.action });
      return { isVerifiedSuccess: false, reason };
    }

    // 4. Production VerificationGateway MUST reject missing authoritative target
    const isConversational = result.action === 'CONVERSATIONAL' || result.action === 'OTHER';
    const effectiveTarget = result.executedTarget || result.requestedTarget;
    if (!isConversational && (!effectiveTarget || effectiveTarget.trim() === '')) {
      const reason = `Step '${result.action}' rejected: missing authoritative target.`;
      logger.warn('[VerificationGateway] Verification rejected (missing authoritative target):', { action: result.action });
      return { isVerifiedSuccess: false, reason };
    }

    // 5. Production VerificationGateway MUST reject missing physical evidence
    const isProduction = process.env.NODE_ENV === 'production' || process.env.STRICT_VERIFICATION === 'true';
    if (isProduction && !evidence) {
      const reason = `Step '${result.action}' rejected: missing physical verification evidence in production.`;
      logger.warn('[VerificationGateway] Verification rejected (missing evidence):', { action: result.action });
      return { isVerifiedSuccess: false, reason };
    }

    if (evidence && (!evidence.data || (typeof evidence.data === 'object' && Object.keys(evidence.data).length === 0))) {
      const reason = `Step '${result.action}' rejected: missing physical evidence payload.`;
      logger.warn('[VerificationGateway] Verification rejected (empty evidence data):', { action: result.action });
      return { isVerifiedSuccess: false, reason };
    }

    logger.info('[VerificationGateway] Step verified successfully:', {
      stepId: result.stepId,
      action: result.action,
      target: result.executedTarget || result.requestedTarget,
      evidence: result.verificationEvidence?.label,
    });

    return {
      isVerifiedSuccess: true,
      reason: result.outputText || `Verified ${result.action} on ${result.executedTarget || result.requestedTarget || 'target'}.`,
    };
  }
}

export const verificationGateway = VerificationGateway.getInstance();
