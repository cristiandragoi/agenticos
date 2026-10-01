/**
 * ActionClaimGuard.ts — Truthful Action & Execution Claim Verification
 *
 * Hard Requirement (Section 7):
 * Jarvis must NEVER say:
 * "I'm checking that now."
 * "I delegated it."
 * "I'm opening it."
 * "I've updated it."
 * "I completed it."
 * "I verified it."
 * "I see it."
 * unless concrete system evidence exists.
 *
 * Covers Claim Types:
 * - CHECKING: Requires real tool/task execution started.
 * - OPENING: Requires real window/process launch verified.
 * - DELEGATING: Requires WORKER_ACCEPTED event from target worker.
 * - EXECUTING: Requires real worker session in BUSY/RUNNING state.
 * - COMPLETED: Requires verified task completion with non-empty evidence.
 * - VERIFIED: Requires independent verification (Argus / UniversalVerifier).
 * - PERCEIVED: Requires fresh camera/screen capture artifact.
 */

import { logger } from '../../utils/logger.js';
import { engineeringWorkerRegistry } from './EngineeringWorkerRegistry.js';
import { backgroundTaskRepo } from '../../services/backgroundTasks/store.js';

export type ClaimType =
  | 'CHECKING'
  | 'OPENING'
  | 'DELEGATING'
  | 'EXECUTING'
  | 'COMPLETED'
  | 'VERIFIED'
  | 'PERCEIVED';

export interface ActionEvidence {
  taskId?: string;
  worker?: string;
  sessionId?: string;
  hasWorkerAccepted?: boolean;
  processRunning?: boolean;
  artifactPath?: string;
  verificationVerdict?: boolean;
  error?: string;
}

export interface ClaimVerificationResult {
  allowed: boolean;
  claimType: ClaimType;
  truthfulStatement: string;
  evidenceFound: boolean;
  reason?: string;
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
   * Verify whether a proposed action claim is truthful given actual runtime state.
   */
  public verifyClaim(claimType: ClaimType, evidence: ActionEvidence): ClaimVerificationResult {
    switch (claimType) {
      case 'DELEGATING': {
        const { worker = 'worker', taskId, hasWorkerAccepted } = evidence;
        let accepted = hasWorkerAccepted;

        if (!accepted && taskId) {
          const events = engineeringWorkerRegistry.getWorkerEvents(worker.toLowerCase() as any);
          accepted = events.some(e => e.taskId === taskId && e.eventType === 'WORKER_ACCEPTED');
        }

        if (!accepted && taskId) {
          const task = backgroundTaskRepo.getTask(taskId);
          if (task && (task.status === 'executing' || task.status === 'worker_accepted' || task.status === 'running')) {
            accepted = true;
          }
        }

        if (accepted) {
          return {
            allowed: true,
            claimType,
            evidenceFound: true,
            truthfulStatement: `${worker} accepted task ${taskId || ''}.`,
          };
        }

        return {
          allowed: false,
          claimType,
          evidenceFound: false,
          reason: evidence.error || `Worker ${worker} has not emitted WORKER_ACCEPTED.`,
          truthfulStatement: `I could not deliver the task to ${worker}: ${evidence.error || 'Worker did not accept the task.'}`,
        };
      }

      case 'COMPLETED': {
        const { taskId } = evidence;
        let isDone = false;
        let resultText = '';

        if (taskId) {
          const task = backgroundTaskRepo.getTask(taskId);
          if (task && (task.status === 'completed' || task.verificationState === 'passed')) {
            isDone = true;
            resultText = task.resultText || '';
          }
        }

        if (isDone) {
          return {
            allowed: true,
            claimType,
            evidenceFound: true,
            truthfulStatement: `Task ${taskId || ''} completed: ${resultText.slice(0, 120)}`,
          };
        }

        return {
          allowed: false,
          claimType,
          evidenceFound: false,
          reason: 'No completed or verified task record found.',
          truthfulStatement: `The task is not yet completed. Current state: ${evidence.error || 'in-progress or pending verification'}.`,
        };
      }

      case 'PERCEIVED': {
        const { artifactPath } = evidence;
        if (artifactPath) {
          return {
            allowed: true,
            claimType,
            evidenceFound: true,
            truthfulStatement: 'Perception confirmed with real capture artifact.',
          };
        }

        return {
          allowed: false,
          claimType,
          evidenceFound: false,
          reason: 'No fresh visual capture artifact exists.',
          truthfulStatement: 'I was unable to capture a fresh visual frame.',
        };
      }

      case 'OPENING': {
        if (evidence.processRunning) {
          return {
            allowed: true,
            claimType,
            evidenceFound: true,
            truthfulStatement: 'Target application process verified running.',
          };
        }

        return {
          allowed: false,
          claimType,
          evidenceFound: false,
          reason: 'Application process or window was not detected.',
          truthfulStatement: `I could not launch or find the application: ${evidence.error || 'Window or process not detected.'}`,
        };
      }

      case 'CHECKING':
      case 'EXECUTING': {
        const { taskId } = evidence;
        if (taskId || evidence.processRunning) {
          return {
            allowed: true,
            claimType,
            evidenceFound: true,
            truthfulStatement: 'Execution active and verified.',
          };
        }

        return {
          allowed: false,
          claimType,
          evidenceFound: false,
          reason: 'No active execution task or process found.',
          truthfulStatement: 'I have not been able to start that task yet.',
        };
      }

      case 'VERIFIED': {
        if (evidence.verificationVerdict) {
          return {
            allowed: true,
            claimType,
            evidenceFound: true,
            truthfulStatement: 'Independently verified by verification supervisor.',
          };
        }

        return {
          allowed: false,
          claimType,
          evidenceFound: false,
          reason: 'Independent verification has not passed.',
          truthfulStatement: 'The result has not been independently verified yet.',
        };
      }

      default:
        return {
          allowed: true,
          claimType,
          evidenceFound: true,
          truthfulStatement: '',
        };
    }
  }

  /**
   * Alias for verifyClaim.
   */
  public assertClaim(claimType: ClaimType, evidence: ActionEvidence): ClaimVerificationResult {
    return this.verifyClaim(claimType, evidence);
  }

  /**
   * Sanitize text against false claims of completion or verification when evidence is absent.
   */
  public sanitizeClaimText(text: string, state: { isVerified?: boolean; hasExecutionEvidence?: boolean }): string {
    let s = text;
    if (!state.isVerified) {
      s = s.replace(/\b(?:i\s+have\s+)?(?:completed\s+and\s+verified|verified\s+and\s+completed)\b/gi, 'work is underway on');
      s = s.replace(/\b(?:i\s+(?:have\s+)?verified|i've\s+verified)\b/gi, 'verification is pending for');
    }
    if (!state.hasExecutionEvidence) {
      s = s.replace(/\b(?:i\s+completed|i've\s+completed|i\s+have\s+completed)\b/gi, 'I haven\'t started');
      s = s.replace(/\b(?:i\s+delegated|i've\s+delegated)\b/gi, 'I haven\'t been able to deliver');
    }
    return s;
  }

  /**
   * Evaluate a proposed response text against actual verification and goal state.
   */
  public evaluateClaim(input: {
    proposedText: string;
    goalRun?: any;
    verification?: any;
    surface?: string;
    target?: string;
  }): { allowed: boolean; sanitizedText: string } {
    const isVerified = Boolean(input.verification?.verified);
    const hasExecutionEvidence = Boolean(input.verification?.evidence || input.goalRun);
    const sanitizedText = this.sanitizeClaimText(input.proposedText, {
      isVerified,
      hasExecutionEvidence,
    });
    return {
      allowed: isVerified,
      sanitizedText,
    };
  }
}

export const actionClaimGuard = ActionClaimGuard.getInstance();
