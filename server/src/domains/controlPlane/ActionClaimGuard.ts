/**
 * ActionClaimGuard.ts — Anti-Hallucination Action Claim Guard (Code-Level Invariant)
 *
 * Invariant: NO EVIDENCE = NO SUCCESS CLAIM.
 *
 * This is a deterministic, code-level contract (NOT prompt instructions).
 * Any speech or text completion claiming operational success must have
 * matching authoritative machine evidence.
 *
 * If evidence is absent:
 * Rewrites the response to factual state:
 * "I attempted X on Y but could not verify completion: [reason]"
 */

import fs from 'node:fs';
import { logger } from '../../utils/logger.js';
import type { GoalRun, GoalVerification } from './types.js';

export interface GuardEvaluation {
  allowed: boolean;
  sanitizedText: string;
  originalText: string;
  violations: string[];
}

export class ActionClaimGuard {
  private static instance: ActionClaimGuard;

  private constructor() {}

  public static getInstance(): ActionClaimGuard {
    if (!ActionClaimGuard.instance) {
      ActionClaimGuard.instance = new ActionClaimGuard();
    }
    return ActionClaimGuard.instance;
  }

  /**
   * Evaluates proposed response text against actual GoalRun verification and evidence.
   */
  public evaluateClaim(opts: {
    proposedText: string;
    goalRun?: GoalRun | null;
    verification?: GoalVerification | null;
    surface?: string;
    target?: string;
  }): GuardEvaluation {
    const { proposedText, goalRun, verification, surface, target } = opts;
    const violations: string[] = [];
    let isClaimingSuccess = false;

    // List of protected claim patterns
    const protectedPatterns = [
      /\b(?:i(?:'ve|\s+have)?\s+(?:opened|launched|started))\b/i,
      /\b(?:completed\s+successfully)\b/i,
      /\b(?:screenshot\s+(?:is\s+)?completed)\b/i,
      /\b(?:desktop\s+completed)\b/i,
      /\b(?:application\s+opened)\b/i,
      /\b(?:found\s+.+)\b/i,
      /\b(?:i\s+can\s+see\s+(?:you|your))\b/i,
      /\b(?:i\s+see\s+you)\b/i,
      /\b(?:is\s+now\s+open)\b/i,
      /\b(?:is\s+open)\b/i,
    ];

    for (const pat of protectedPatterns) {
      if (pat.test(proposedText)) {
        isClaimingSuccess = true;
        break;
      }
    }

    // If text does not claim an operational action success, let it pass
    if (!isClaimingSuccess) {
      return {
        allowed: true,
        sanitizedText: proposedText,
        originalText: proposedText,
        violations: [],
      };
    }

    // Check 1: Must have verification record
    if (!verification && !goalRun?.verification) {
      violations.push('No independent verification record exists for this goal');
    }

    const effectiveVerif = verification || goalRun?.verification;

    // Check 2: Verification must be true
    if (!effectiveVerif?.verified) {
      violations.push(`Verification is false (${effectiveVerif?.summary || 'unverified'})`);
    }

    // Check 3: Domain-specific physical artifact verification
    const s = (surface || '').toLowerCase();
    const t = (target || '').toLowerCase();

    // Browser cannot fulfill desktop or screenshot goals
    if (
      (proposedText.toLowerCase().includes('screenshot') || t.includes('screenshot') || t === 'desktop') &&
      s === 'browser'
    ) {
      violations.push('Browser execution cannot fulfill desktop screenshot goal');
    }

    // Screenshot claims require actual existing image artifact with byteSize >= 1024
    if (proposedText.toLowerCase().includes('screenshot')) {
      const actual = effectiveVerif?.actualState as any;
      if (!actual?.artifactPath || !fs.existsSync(actual.artifactPath)) {
        violations.push('Screenshot claim requires a verified file on disk');
      } else if (!actual.byteSize || actual.byteSize < 1024) {
        violations.push('Screenshot claim requires valid image byteSize > 1024');
      }
    }

    // Camera vision claims require verified physical frame hash
    const isVisionPerceptionClaim =
      proposedText.toLowerCase().includes('see you') ||
      proposedText.toLowerCase().includes('can see') ||
      s === 'camera' ||
      (t.includes('camera') && (s === 'camera' || s === 'camera_perceive'));

    if (isVisionPerceptionClaim) {
      const actual = effectiveVerif?.actualState as any;
      const sha = actual?.frameSha256 || actual?.frameMetadata?.frameSha256;
      if (!actual?.hasFrame || !sha) {
        violations.push('Camera vision claim requires a physical captured frame and cryptographic hash');
      }
    }

    // Application open claims require process or HWND evidence
    if (proposedText.toLowerCase().includes('is open') || proposedText.toLowerCase().includes('opened')) {
      const actual = effectiveVerif?.actualState as any;
      const evidence = effectiveVerif?.evidence || [];
      const hasProcessOrHwnd = actual?.hwnd || actual?.pid || evidence.some((e: any) => e.type === 'process' || e.type === 'window');
      if (!hasProcessOrHwnd) {
        violations.push('Application open claim requires verified HWND or running process evidence');
      }
    }

    if (violations.length === 0) {
      return {
        allowed: true,
        sanitizedText: proposedText,
        originalText: proposedText,
        violations: [],
      };
    }

    // REWRITE TO FACTUAL ATTEMPT STATE
    const targetName = target || 'the requested item';
    const reason = violations.join('; ');
    const sanitizedText = `I attempted to process ${targetName}, but physical verification could not be confirmed: ${reason}.`;

    logger.warn(`[ActionClaimGuard] Blocked false success claim: "${proposedText}". Rewrote to: "${sanitizedText}"`);

    return {
      allowed: false,
      sanitizedText,
      originalText: proposedText,
      violations,
    };
  }
}

export const actionClaimGuard = ActionClaimGuard.getInstance();
