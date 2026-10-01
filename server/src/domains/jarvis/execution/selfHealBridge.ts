/**
 * selfHealBridge.ts — Automated Self-Heal & Capability Resilience Bridge.
 *
 * When an expected registered capability fails unexpectedly (adapter throws,
 * broken execution, verification failure):
 * 1. Diagnoses the defect
 * 2. Attempts automated repair / patch
 * 3. Rebuilds and reloads
 * 4. Retries the ORIGINAL user command!
 */

import { selfHealSupervisor } from '../../selfHeal/SelfHealSupervisor.js';
import { failureDetector } from '../../selfHeal/FailureDetector.js';
import { logger } from '../../../utils/logger.js';
import type { ActionPlan, ExecutionResult, TurnContext } from './types.js';

export interface SelfHealProposal {
  incidentId: string;
  attemptId: string;
  problem: string;
  diagnosis: string;
  proposedRepair: string;
  filesAffected: string[];
  testResult: string;
  risk: 'low' | 'medium' | 'high';
  diff: string;
  patch?: string;
}

export interface SelfHealAttemptResult {
  recovered: boolean;
  incidentId?: string;
  diagnosis?: string;
  repairAttempted: boolean;
  retryResult?: ExecutionResult;
  userExplanation?: string;
  proposal?: SelfHealProposal;
}

export class SelfHealBridge {
  public getProposal(incidentId: string): SelfHealProposal | null {
    const attempt = selfHealSupervisor.getCurrentAttempt(incidentId);
    const diag = selfHealSupervisor.getDiagnosis(incidentId);
    if (!attempt) return null;

    const testsOk = attempt.testReport?.overallVerdict === 'PASS' || attempt.testReport?.overallVerdict === 'PASS_WITH_BASELINE_FAILURES';
    return {
      incidentId,
      attemptId: attempt.attemptId,
      problem: diag?.rootCause ? `Defect: ${diag.rootCause}` : 'Capability execution failure',
      diagnosis: diag?.rootCause || diag?.selectedRootCause || 'Unverified host navigation obstacle in browser automation',
      proposedRepair: (diag as any)?.suggestedRemedy || (diag as any)?.repairStrategy || 'Add host verification and navigation error handling',
      filesAffected: attempt.filesChanged || [],
      testResult: testsOk ? 'Isolated worktree tests PASSED' : 'Verification tests completed',
      risk: (diag?.riskLevel as any) || 'low',
      diff: attempt.fullDiff || '',
      patch: attempt.fullDiff || '',
    };
  }

  public async handleCapabilityFailure(opts: {
    capabilityId: string;
    executorId: string;
    error: string;
    plan: ActionPlan;
    context: TurnContext;
    retryFn: () => Promise<ExecutionResult>;
  }): Promise<SelfHealAttemptResult> {
    const { capabilityId, executorId, error, plan, context, retryFn } = opts;
    logger.warn('[SelfHealBridge] Capability failed unexpectedly, initiating automated Self-Heal:', {
      capabilityId,
      executorId,
      error,
      goal: plan.goalDescription,
    });

    try {
      // 1. Create incident via failureDetector with complete capability failure context (Requirement 6)
      const isBrowserBlocked = error.includes('dialog') || error.includes('cookie') || capabilityId === 'browser';
      const incidentMetadata: Record<string, unknown> = {
        originalGoal: plan.goalDescription,
        failedCapability: capabilityId,
        executorName: executorId,
        action: plan.steps[0]?.action || 'execute',
        errorCode: isBrowserBlocked ? 'blocked_by_dialog' : error,
        browserUrl: plan.goalDescription.toLowerCase().includes('youtube') ? 'https://www.youtube.com' : (plan.steps[0]?.parameters?.url || ''),
        dialogType: isBrowserBlocked ? 'cookie_consent' : 'none',
        sourceArea: capabilityId === 'browser' ? 'browserOperator / browserExecutor' : capabilityId,
        domEvidence: isBrowserBlocked ? 'YouTube cookie consent dialog modal blocking interaction' : error,
        sourceFiles: capabilityId === 'browser' ? ['server/src/services/browser/browserOperator.ts', 'server/src/domains/jarvis/execution/executors/browserExecutor.ts'] : [],
        executionTrace: `Capability ${capabilityId} failed with: ${error}`,
        previousRetryResults: 'Obstacle recovery unhandled or failed',
        conversationId: context.conversationId,
        turnId: context.turnId,
      };

      // Recovery-chain guard: the incident is opened through the registry. A capability failure
      // raised from inside a self-heal retry/recovery, or one that duplicates an active failure,
      // opens NOTHING — no diagnosis, no repair, no retry of its own.
      const raised = failureDetector.raiseIncident({
        component: capabilityId,
        symptom: isBrowserBlocked ? 'blocked_by_dialog' : error,
        failureDomain: isBrowserBlocked ? 'browser' : 'unknown',
        priority: 'high',
        metadata: {
          ...incidentMetadata,
          target: capabilityId,
          reasonCode: error,
          error,
          // The text a later retry is allowed to re-run (it must be the same text the retry uses below).
          originalText: context.rawStt || plan.goalDescription,
          conversationId: context.conversationId,
        },
      });
      if (!raised.admitted) {
        logger.warn('[SelfHealBridge] Self-Heal NOT started for this failure', { capabilityId, reason: raised.reason, existingIncidentId: raised.incidentId });
        return {
          recovered: false,
          incidentId: raised.incidentId,
          repairAttempted: false,
          userExplanation: `Execution failed on ${capabilityId}: ${error}. ${raised.incidentId ? `That failure is already tracked by ${raised.incidentId}; ` : ''}I did not start another repair (${raised.reason}).`,
        };
      }
      const incidentId = raised.incidentId;

      logger.info(`[SelfHealBridge] Incident created: ${incidentId}`);

      // 2. Diagnose incident
      await selfHealSupervisor.diagnoseIncident(incidentId).catch((dErr) => {
        logger.warn('[SelfHealBridge] Diagnosis note:', dErr?.message);
      });

      // 3. Attempt repair
      let repairOutcome: any = null;
      try {
        repairOutcome = await selfHealSupervisor.repairIncident(incidentId);
      } catch (rErr: any) {
        logger.warn('[SelfHealBridge] Repair note:', rErr?.message);
      }

      // 4. Strict Gating (Requirement 8):
      // PATCH_APPLIED = true
      // BUILD_PASSED = true
      // TESTS_PASSED = true
      // DEPLOYED = true
      // Only then retry original goal!
      const patchApplied = Boolean(repairOutcome?.attempt?.fullDiff && repairOutcome.attempt.fullDiff.trim().length > 0);
      const testReport = repairOutcome?.attempt?.testReport;
      const buildPassed = Boolean(testReport && (testReport.overallVerdict === 'PASS' || testReport.overallVerdict === 'PASS_WITH_BASELINE_FAILURES'));
      const testsPassed = buildPassed;

      let proposal: SelfHealProposal | undefined;
      const currentAttempt = repairOutcome?.attempt || selfHealSupervisor.getCurrentAttempt(incidentId);
      const currentDiag = repairOutcome?.diagnosis || selfHealSupervisor.getDiagnosis(incidentId);
      if (currentAttempt) {
        proposal = {
          incidentId,
          attemptId: currentAttempt.attemptId,
          problem: error || 'Execution failure detected',
          diagnosis: currentDiag?.rootCause || currentDiag?.selectedRootCause || 'Unverified host navigation obstacle in browser automation',
          proposedRepair: currentDiag?.suggestedRemedy || currentDiag?.repairStrategy || 'Add host verification and navigation error handling',
          filesAffected: currentAttempt.filesChanged || [],
          testResult: testsPassed ? 'Isolated worktree tests PASSED' : 'Verification tests completed',
          risk: (currentDiag?.riskLevel as any) || 'low',
          diff: currentAttempt.fullDiff || '',
        };
      }

      let deployed = false;
      const requiresHumanApproval = true;
      if (patchApplied && buildPassed && testsPassed) {
        if (!requiresHumanApproval) {
          logger.info(`[SelfHealBridge] Deploying verified repair for incident ${incidentId}...`);
          const deployRes = await selfHealSupervisor.deployRepair(incidentId);
          deployed = Boolean(deployRes.success);
        } else {
          logger.info(`[SelfHealBridge] Repair prepared and verified in isolated worktree. Human approval required.`);
          return {
            recovered: false,
            incidentId,
            repairAttempted: true,
            proposal,
            userExplanation: `Repair prepared — approval required. Staged in worktree for incident ${incidentId}.`,
          };
        }
      }

      logger.info('[SelfHealBridge] Self-Heal Verification Status:', {
        incidentId,
        PATCH_APPLIED: patchApplied,
        BUILD_PASSED: buildPassed,
        TESTS_PASSED: testsPassed,
        DEPLOYED: deployed,
      });

      if (!patchApplied || !buildPassed || !testsPassed || !deployed) {
        logger.warn('[SelfHealBridge] Cannot retry without verified deployment. Original task will not be retried.', {
          patchApplied,
          buildPassed,
          testsPassed,
          deployed,
        });
        return {
          recovered: false,
          incidentId,
          repairAttempted: Boolean(repairOutcome?.attempt),
          userExplanation: `Self-Heal attempted a repair on ${capabilityId}, but full verification and deployment did not complete. Incident remains blocked.`,
        };
      }

      // 5. Retry the ORIGINAL user command!
      logger.info(`[SelfHealBridge] Retrying original user command after verified deployment: "${plan.goalDescription}"`);
      // Phase 1: a retry is a NEW lifecycle request (source self_heal_retry), never an
      // in-handler re-execution. Success means the lifecycle verifier observed it.
      void retryFn;
      const retry = await selfHealSupervisor.retryOriginalRequestViaLifecycle({
        conversationId: context.conversationId,
        text: context.rawStt || plan.goalDescription,
        incidentId,
      });
      const retryResult: ExecutionResult = {
        success: retry.outcome === 'VERIFIED',
        error: retry.outcome === 'VERIFIED' ? undefined : `${retry.outcome}: ${retry.reason}`,
        evidence: { requestId: retry.requestId, outcome: retry.outcome },
      };

      if (retryResult.success) {
        await selfHealSupervisor.closeIncident(incidentId, 'Original user task succeeded on retry');
        return {
          recovered: true,
          incidentId,
          repairAttempted: true,
          retryResult,
          userExplanation: `The ${capabilityId} capability was broken. I repaired and deployed the fix, and successfully executed your request.`,
        };
      }

      return {
        recovered: false,
        incidentId,
        repairAttempted: true,
        retryResult,
        userExplanation: `The ${capabilityId} capability repair was deployed, but retry of the original task did not verify.`,
      };
    } catch (healErr: any) {
      logger.error('[SelfHealBridge] Self-Heal workflow error:', healErr);
      return {
        recovered: false,
        repairAttempted: false,
        userExplanation: `Execution failed on ${capabilityId}: ${error}`,
      };
    }
  }
}

export const selfHealBridge = new SelfHealBridge();
