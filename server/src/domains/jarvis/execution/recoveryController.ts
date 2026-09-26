/**
 * recoveryController.ts — Human-in-the-Loop Self-Heal Repair Controller
 *
 * Implements the complete recovery lifecycle:
 * AWAITING_APPROVAL -> USER INSPECTION -> APPROVE / REJECT -> APPLY -> VERIFY -> RETRY -> RECOVERED
 */

import { selfHealSupervisor } from '../../selfHeal/SelfHealSupervisor.js';
import { deploymentGate, computePatchHash } from '../../selfHeal/DeploymentGate.js';
import { repairMemory } from '../../selfHeal/RepairMemory.js';
import { selfHealBridge, type SelfHealProposal } from './selfHealBridge.js';
import { universalExecutionController } from './universalExecutionController.js';
import { logger } from '../../../utils/logger.js';
import { execSync } from 'node:child_process';

export interface ApprovalResult {
  success: boolean;
  status: 'recovered' | 'recovery_failed' | 'conflict' | 'verification_failed' | 'rejected' | 'error';
  message: string;
  incidentId: string;
  originalGoal?: string;
  retryResult?: any;
}

export class RecoveryController {
  /**
   * Retrieve the complete repair proposal for an incident
   */
  public getProposal(incidentId: string): SelfHealProposal | null {
    return selfHealBridge.getProposal(incidentId);
  }

  /**
   * Explicit human approval of a proposed repair.
   * Enforces:
   * 1. State must be AWAITING_APPROVAL
   * 2. Patch hash validation
   * 3. Working tree conflict detection (no silent overwrite of modified code)
   * 4. Canonical patch application
   * 5. Post-apply verification
   * 6. Canonical original-goal retry (bounded: exactly 1 retry cycle)
   * 7. Verifies final post-condition
   */
  public async approveRepair(opts: {
    incidentId: string;
    conversationId?: string;
    turnId?: string;
    approver?: string;
    onProgress?: (progress: any) => void;
    verifyFn?: () => Promise<boolean> | boolean;
  }): Promise<ApprovalResult> {
    const { incidentId, conversationId, turnId, approver = 'human', onProgress } = opts;
    logger.info(`[RecoveryController] Approve repair requested for incident ${incidentId} by ${approver}`);

    // 1. Verify incident state
    const currentState = selfHealSupervisor.getIncidentState(incidentId);
    if (!currentState || currentState !== 'AWAITING_APPROVAL') {
      logger.warn(`[RecoveryController] Cannot approve: state is ${currentState || 'UNKNOWN'}`);
      return {
        success: false,
        status: 'error',
        message: currentState
          ? `Cannot approve: incident is in state ${currentState}, not AWAITING_APPROVAL.`
          : 'Repair approval state could not be restored. No changes were applied.',
        incidentId,
      };
    }

    // 2. Retrieve attempt and verify patch integrity
    const attempt = selfHealSupervisor.getCurrentAttempt(incidentId);
    if (!attempt) {
      return {
        success: false,
        status: 'error',
        message: `No active repair attempt found for incident ${incidentId}.`,
        incidentId,
      };
    }

    const currentPatchHash = computePatchHash(attempt.fullDiff);

    // 3. Working tree conflict check
    const conflictCheck = selfHealSupervisor.checkConflict(incidentId);
    if (conflictCheck.conflict) {
      logger.warn(`[RecoveryController] Conflict detected for ${incidentId}:`, conflictCheck.conflictingFiles);
      const conflictMsg = 'Repair could not be applied safely because the code changed after the repair was prepared.';
      onProgress?.({
        status: 'failed',
        stage: 'CONFLICT',
        currentStep: 'Conflict detected',
        recovery: conflictMsg,
        conflictFiles: conflictCheck.conflictingFiles,
      });
      return {
        success: false,
        status: 'conflict',
        message: 'The code changed after the repair was prepared, so I did not apply it automatically.',
        incidentId,
      };
    }

    // 4. Record approval & transition to APPROVED
    try {
      selfHealSupervisor.approveRepair(incidentId, approver);
      deploymentGate.assertApproved(incidentId, attempt.attemptId, currentPatchHash);
    } catch (apprErr: any) {
      logger.error(`[RecoveryController] Approval recording failed:`, apprErr);
      return {
        success: false,
        status: 'error',
        message: `Approval failed: ${apprErr?.message}`,
        incidentId,
      };
    }

    onProgress?.({
      status: 'running',
      stage: 'APPROVED',
      currentStep: `Approved by ${approver}`,
      recovery: 'Repair approved. Applying to production...',
    });

    // 5. Deploy repair to production
    onProgress?.({
      status: 'running',
      stage: 'APPLYING',
      currentStep: 'Applying repair patch to production repository...',
    });

    const deployRes = await selfHealSupervisor.deployRepair(incidentId, approver);
    if (!deployRes.success) {
      logger.error(`[RecoveryController] Deploy failed for ${incidentId}:`, deployRes.error);
      onProgress?.({
        status: 'failed',
        stage: 'DEPLOY_FAILED',
        currentStep: 'Patch deployment failed',
        recovery: `Failed to deploy repair: ${deployRes.error}`,
      });
      return {
        success: false,
        status: 'error',
        message: `Deployment failed: ${deployRes.error}`,
        incidentId,
      };
    }

    // 6. Post-apply verification in production
    onProgress?.({
      status: 'running',
      stage: 'VERIFYING_REPAIR',
      currentStep: 'Verifying repair in production...',
    });

    let postApplyOk = true;
    try {
      if (opts.verifyFn) {
        postApplyOk = await opts.verifyFn();
      } else {
        // Run quick build/lint/typecheck verification on production server
        execSync('npm run build', { cwd: 'D:\\AgenticOS\\server', stdio: 'pipe' });
      }
    } catch (vErr: any) {
      logger.warn(`[RecoveryController] Post-apply verification failed:`, vErr?.message);
      postApplyOk = false;
    }

    if (!postApplyOk) {
      onProgress?.({
        status: 'failed',
        stage: 'VERIFICATION_FAILED',
        currentStep: 'Post-apply verification failed',
        recovery: 'The repair was applied, but verification failed.',
      });
      return {
        success: false,
        status: 'verification_failed',
        message: 'The repair was applied in the recovery environment, but verification failed, so I did not treat the issue as resolved.',
        incidentId,
      };
    }

    onProgress?.({
      status: 'running',
      stage: 'VERIFIED',
      currentStep: 'Repair verified in production',
      recovery: 'Verification passed! Retrying original user request...',
    });

    // 7. Retrieve the original failed operational goal
    const incident = await repairMemory.getIncident(incidentId);
    const metadata = (incident?.metadata || {}) as Record<string, any>;
    const originalGoal = metadata.originalGoal || attempt.diffSummary || 'Open YouTube';

    logger.info(`[RecoveryController] Retrying original user goal: "${originalGoal}"`);

    onProgress?.({
      status: 'running',
      stage: 'RETRYING_ORIGINAL_GOAL',
      currentStep: `Retrying original request: "${originalGoal}"`,
      recovery: `Retrying original request: "${originalGoal}"`,
    });

    // 8. Canonical retry through UniversalExecutionController (single bounded attempt)
    let retryResult: any = null;
    try {
      retryResult = await universalExecutionController.handleUserTurn({
        prompt: originalGoal,
        conversationId: conversationId || metadata.conversationId || 'conv-recovery',
        turnId: `retry-${Date.now()}`,
        isBargeIn: false,
        onProgress,
      });
    } catch (rErr: any) {
      logger.error(`[RecoveryController] Retry execution failed:`, rErr);
    }

    const retrySuccess = Boolean(retryResult?.execution?.success && retryResult?.verification?.verified);

    if (retrySuccess) {
      await selfHealSupervisor.closeIncident(incidentId, 'Original user task succeeded on retry');
      onProgress?.({
        status: 'completed',
        stage: 'RECOVERED',
        currentStep: 'Recovered — original request verified',
        recovery: `The repair was applied successfully and verified. Original request succeeded.`,
        result: retryResult?.spokenText || `Request completed.`,
      });

      const naturalResponse = `The repair was applied successfully and verified. I retried your request, and ${retryResult?.entityName || 'the requested view'} is open now.`;

      return {
        success: true,
        status: 'recovered',
        message: naturalResponse,
        incidentId,
        originalGoal,
        retryResult,
      };
    }

    // Retry failed
    onProgress?.({
      status: 'failed',
      stage: 'RECOVERY_FAILED',
      currentStep: 'Recovery failed — retry did not succeed',
      recovery: 'The repair was applied and verified, but retrying the request did not succeed.',
    });

    return {
      success: false,
      status: 'recovery_failed',
      message: 'The repair was applied and verified, but retrying the request did not succeed.',
      incidentId,
      originalGoal,
      retryResult,
    };
  }

  /**
   * Explicit user rejection of a proposed repair.
   * Leaves production code completely unchanged.
   */
  public async rejectRepair(opts: {
    incidentId: string;
    conversationId?: string;
    reason?: string;
    onProgress?: (progress: any) => void;
  }): Promise<ApprovalResult> {
    const { incidentId, reason = 'Rejected by user', onProgress } = opts;
    logger.info(`[RecoveryController] Reject repair requested for incident ${incidentId}`);

    const currentState = selfHealSupervisor.getIncidentState(incidentId);
    if (!currentState) {
      return {
        success: false,
        status: 'error',
        message: 'Repair approval state could not be restored. No changes were applied.',
        incidentId,
      };
    }

    selfHealSupervisor.rejectRepair(incidentId, reason);

    onProgress?.({
      status: 'failed',
      stage: 'REJECTED',
      currentStep: 'Repair rejected',
      recovery: 'Proposed repair rejected by user. System remains unchanged.',
    });

    return {
      success: true,
      status: 'rejected',
      message: 'I left the system unchanged. The proposed repair was rejected.',
      incidentId,
    };
  }
}

export const recoveryController = new RecoveryController();
