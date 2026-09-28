/**
 * AutonomousRecoveryEngine.ts — Universal Autonomous Recovery & Escalation Engine
 *
 * Implements Section 4, 5, 7, and 11:
 * - General Failure Recovery across all actions
 * - Tries safe operational alternatives first via AlternativeStrategyPlanner
 * - Automatically escalates to Engineering Recovery without user micromanagement
 * - Coordinates Jarvis, Hermes, Engineering Worker, and Argus Independent Verifier
 * - Retries the original GoalRun and verifies real-world outcome
 */

import { logger } from '../../utils/logger.js';
import { goalLifecycleManager } from './GoalLifecycle.js';
import { capabilityDiscovery } from './CapabilityDiscovery.js';
import { alternativeStrategyPlanner } from './AlternativeStrategyPlanner.js';
import { universalVerifier } from './UniversalVerifier.js';
import { repairKnowledgeStore } from './RepairKnowledgeStore.js';
import { repositoryAuthority } from './RepositoryAuthority.js';
import { recoveryWatchdog } from './RecoveryWatchdog.js';
import { selfHealSupervisor } from '../selfHeal/SelfHealSupervisor.js';
import type { GoalRun, GoalAttempt, GoalFailure, GoalVerification } from './types.js';

export interface RecoveryOutcome {
  success: boolean;
  status: 'COMPLETED' | 'FAILED_EXHAUSTED' | 'BLOCKED_EXTERNAL';
  finalResponseText: string;
  verification?: GoalVerification;
  incidentId?: string;
}

export class AutonomousRecoveryEngine {
  private static instance: AutonomousRecoveryEngine;

  private constructor() {}

  public static getInstance(): AutonomousRecoveryEngine {
    if (!AutonomousRecoveryEngine.instance) {
      AutonomousRecoveryEngine.instance = new AutonomousRecoveryEngine();
    }
    return AutonomousRecoveryEngine.instance;
  }

  /**
   * Main recovery entry point when an action execution fails or fails verification.
   */
  public async handleFailure(opts: {
    goalId: string;
    failedAttempt: GoalAttempt;
    target: string;
    goalType: string;
    entityId?: string;
    entityType?: string;
    entityName?: string;
    verb?: string;
    onActionProgress?: (update: any) => void;
    executeStrategy: (strategy: { surface: string; target: string; parameters?: any }) => Promise<{ executed: boolean; error?: string }>;
  }): Promise<RecoveryOutcome> {
    const { goalId, failedAttempt, target, goalType, executeStrategy, onActionProgress } = opts;
    const goal = goalLifecycleManager.getGoalRun(goalId);
    if (!goal) throw new Error(`[AutonomousRecoveryEngine] Goal ${goalId} not found.`);

    logger.warn(`[AutonomousRecoveryEngine] Action failed for goal ${goalId}: ${failedAttempt.strategy} on ${failedAttempt.surface}. Initiating recovery.`);
    console.log(`[JRT] RECOVERY_STARTED goalId=${goalId} failedSurface=${failedAttempt.surface} target="${target}"`);

    // 1. Transition state: RECOVERING
    goalLifecycleManager.transitionState(goalId, 'RECOVERING', {
      actor: 'ControlPlane',
      summary: `Action failed on surface "${failedAttempt.surface}". Starting autonomous recovery.`,
      detail: { failedStrategy: failedAttempt.strategy, error: failedAttempt.error },
    });

    onActionProgress?.({
      actionName: `Recover ${target}`,
      targetCapability: failedAttempt.surface,
      status: 'running',
      stage: 'RECOVERING',
      currentStep: `First attempt failed on ${failedAttempt.surface}. Diagnosing and seeking alternatives...`,
      goalId,
    });

    // 2. Propose & Try Safe Operational Alternative Strategies
    goalLifecycleManager.transitionState(goalId, 'TRYING_ALTERNATIVE', {
      actor: 'Hermes',
      summary: `Planning operational alternatives across execution surfaces.`,
    });

    const failedSurfaces = [failedAttempt.surface];
    const alternatives = await alternativeStrategyPlanner.planAlternatives({
      target,
      goalType,
      failedSurfaces,
    });

    for (const alt of alternatives) {
      const attemptNum = goal.attempts.length + 1;
      const startedAt = new Date().toISOString();
      console.log(`[JRT] TRYING_ALTERNATIVE goalId=${goalId} surface=${alt.surface} target="${alt.target}"`);

      onActionProgress?.({
        actionName: `Try ${alt.surface}: ${target}`,
        targetCapability: alt.surface,
        status: 'running',
        stage: 'TRYING_ALTERNATIVE',
        currentStep: `Trying alternative execution surface: ${alt.surface} (${alt.target})...`,
        goalId,
      });

      let execResult: { executed: boolean; error?: string } = { executed: false };
      try {
        execResult = await executeStrategy({
          surface: alt.surface,
          target: alt.target,
          parameters: alt.parameters,
        });
      } catch (err: any) {
        execResult = { executed: false, error: err?.message };
      }

      // Verify the alternative attempt
      let verification: GoalVerification = {
        verified: false,
        method: 'UniversalVerifier',
        expectedState: { target: alt.target },
        actualState: null,
        evidence: [],
        verifier: 'UniversalVerifier',
        timestamp: new Date().toISOString(),
        summary: 'Not verified',
      };

      if (execResult.executed) {
        verification = await universalVerifier.verify({
          surface: alt.surface,
          target: alt.target,
          parameters: alt.parameters,
        });
      }

      const attemptRecord: GoalAttempt = {
        attemptNumber: attemptNum,
        strategy: alt.strategyName,
        surface: alt.surface,
        target: alt.target,
        parameters: alt.parameters,
        startedAt,
        completedAt: new Date().toISOString(),
        executed: execResult.executed,
        verified: verification.verified,
        evidence: verification.evidence || [],
        error: execResult.error,
      };

      goalLifecycleManager.recordAttempt(goalId, attemptRecord);

      if (verification.verified) {
        // Operational recovery succeeded!
        console.log(`[JRT] ALTERNATIVE_SUCCEEDED goalId=${goalId} surface=${alt.surface} target="${alt.target}"`);
        goalLifecycleManager.recordVerification(goalId, verification);

        // Learn and record resolution (never learn web search fallbacks as resolutions for non-web targets)
        const isWebFallback = alt.surface === 'browser' && (alt.target.includes('google.com/search') || alt.target.includes('bing.com') || alt.target.includes('duckduckgo.com'));
        if (!isWebFallback) {
          const learnedResolution = {
            target,
            goalType,
            successfulStrategy: alt.strategyName,
            surface: alt.surface,
            executablePath: alt.surface === 'executable' || alt.surface === 'start_menu' || alt.surface === 'taskbar' ? alt.target : undefined,
            url: alt.surface === 'browser' ? alt.target : undefined,
            parameters: alt.parameters,
            verificationMethod: verification.method,
            confidence: 0.95,
            learnedAt: new Date().toISOString(),
          };
          repairKnowledgeStore.recordResolution(learnedResolution);
          goalLifecycleManager.recordLearnedResolution(goalId, learnedResolution);
        }

        const completionMsg = isWebFallback
          ? `Could not find a local application for "${target}". Opened web search instead.`
          : `${target} completed successfully via ${alt.surface}.`;
        goalLifecycleManager.transitionState(goalId, 'COMPLETED', {
          actor: 'UniversalVerifier',
          summary: completionMsg,
          detail: verification,
        });

        onActionProgress?.({
          actionName: `Completed ${target}`,
          targetCapability: alt.surface,
          status: 'completed',
          stage: 'COMPLETED',
          currentStep: completionMsg,
          goalId,
        });

        return {
          success: true,
          status: 'COMPLETED',
          finalResponseText: completionMsg,
          verification,
        };
      } else {
        failedSurfaces.push(alt.surface);
        goalLifecycleManager.recordFailure(goalId, {
          attemptNumber: attemptNum,
          strategy: alt.strategyName,
          reason: execResult.error || verification.summary,
          failureDomain: 'operational',
          rawError: execResult.error,
          timestamp: new Date().toISOString(),
          evidence: verification.evidence || [],
        });
      }
    }

    // 3. Operational recovery exhausted -> Escalate to Engineering Recovery
    logger.info(`[AutonomousRecoveryEngine] Operational alternatives exhausted. Escalating to Engineering Repair.`);
    console.log(`[JRT] ESCALATING_TO_ENGINEERING goalId=${goalId} target="${target}"`);

    return this.escalateToEngineering({
      goal,
      target,
      verb: opts.verb || 'execute',
      entityId: opts.entityId || target,
      entityType: opts.entityType || 'capability',
      entityName: opts.entityName || target,
      onActionProgress,
    });
  }

  /**
   * Escalates to Engineering Recovery (Section 5, 7, 11).
   */
  private async escalateToEngineering(opts: {
    goal: GoalRun;
    target: string;
    verb: string;
    entityId: string;
    entityType: string;
    entityName: string;
    onActionProgress?: (update: any) => void;
  }): Promise<RecoveryOutcome> {
    const { goal, target, verb, entityId, entityType, entityName, onActionProgress } = opts;
    const goalId = goal.goalId;

    // Validate Authoritative Repository before proceeding (Section 6)
    repositoryAuthority.assertRepositoryHealthy();

    const incidentId = `SELFHEAL-${Date.now().toString().slice(-4)}`;
    goalLifecycleManager.linkIncident(goalId, incidentId);

    goalLifecycleManager.transitionState(goalId, 'ENGINEERING_REPAIR', {
      actor: 'Hermes',
      summary: `Engineering defect detected. Created incident ${incidentId}. Delegating to Hermes & Engineering Worker.`,
      detail: { incidentId, repoRoot: repositoryAuthority.getRepositoryRoot() },
    });

    onActionProgress?.({
      actionName: `Repair ${verb}:${entityName}`,
      targetCapability: 'engineering',
      status: 'running',
      stage: 'ENGINEERING_REPAIR',
      currentStep: `Internal defect detected (${incidentId}). Dispatched Hermes & engineering worker...`,
      goalId,
      incidentId,
    });

    console.log(`[JRT] SELFHEAL_DETECTED component=jarvis.capability.${verb}.${entityId} goalId=${goalId}`);
    console.log(`[JRT] SELFHEAL_INCIDENT_CREATED incidentId=${incidentId} goalId=${goalId}`);

    // Execute closed loop repair with RecoveryWatchdog protection
    let repairResult: { success: boolean; outcome?: any; verification?: any; error?: string } = { success: false };

    try {
      const watchdogExecution = await recoveryWatchdog.checkStageExecution({
        incidentId,
        stage: 'repair_execution',
        executeDefault: async () => {
          return selfHealSupervisor.executeClosedLoopRepair({
            incidentId,
            goalId,
            conversationId: goal.conversationId,
            turnId: goal.turnId,
            attemptId: String(goal.currentAttempt),
            originalUserInput: goal.originalUserInput,
            normalizedGoal: goal.normalizedGoal,
            capabilityId: `jarvis.capability.${verb}.${entityId}`,
            target,
            userAction: {
              verb,
              target,
              originalPrompt: goal.originalUserInput,
              entityId,
              entityType,
              entityName,
              conversationId: goal.conversationId,
            },
            failureClassification: {
              domain: 'implementation',
              repairability: 'engineering',
              reason: `Operational recovery alternatives exhausted for "${target}"`,
            },
            failureEvidence: goal.failures?.flatMap(f => f.evidence || []) || [],
            originalAction: {
              prompt: goal.originalUserInput,
              conversationId: goal.conversationId,
              entityId,
              entityType,
              entityName,
              verb,
            },
          });
        },
        executeFallback: async () => {
          logger.warn(`[AutonomousRecoveryEngine] Watchdog fallback executed for incident ${incidentId}`);
          return { success: true, outcome: { fallbackApplied: true } };
        },
      });

      repairResult = watchdogExecution.result;
    } catch (err: any) {
      repairResult = { success: false, error: err?.message };
    }

    if (repairResult.success) {
      // Independent Verification (Section 7, 8)
      goalLifecycleManager.transitionState(goalId, 'INDEPENDENT_VERIFICATION', {
        actor: 'Argus',
        summary: `Argus performing independent post-repair verification on original state.`,
      });

      onActionProgress?.({
        actionName: `Verify ${entityName}`,
        targetCapability: 'verification',
        status: 'running',
        stage: 'INDEPENDENT_VERIFICATION',
        currentStep: 'Argus independently verifying original state in authoritative store...',
        goalId,
        incidentId,
      });

      let expectedName = (opts as any).parameters?.expectedName || (opts as any).parameters?.newName;
      if (!expectedName && verb === 'rename') {
        const m = (goal.normalizedGoal || goal.originalUserInput).match(/\b(?:rename|change(?:\s+the\s+name\s+of)?)\s+(.+?)\s+to\s+(.+?)(?:[.]|$)/i);
        if (m) expectedName = m[2].trim();
      }
      if (!expectedName) expectedName = target;

      let surfaceToVerify = 'internal';
      if (target.toLowerCase().includes('camera') || verb.includes('camera') || goal.originalUserInput.toLowerCase().includes('camera')) {
        surfaceToVerify = 'camera';
      } else if (target.toLowerCase().includes('hermes') || goal.originalUserInput.toLowerCase().includes('hermes')) {
        surfaceToVerify = 'desktop_observe';
      } else if (target.toLowerCase().includes('screenshot') || goal.originalUserInput.toLowerCase().includes('screenshot')) {
        surfaceToVerify = 'screenshot';
      } else if (entityType === 'project') {
        surfaceToVerify = 'internal';
      } else {
        surfaceToVerify = 'desktop';
      }

      const verification = repairResult.verification || await universalVerifier.verify({
        surface: surfaceToVerify,
        target: entityId || target,
        parameters: { entityType, entityId, expectedName, prompt: goal.originalUserInput, target },
      });

      console.log(`[JRT] INDEPENDENT_VERIFICATION_COMPLETE verified=${verification.verified} verifier=Argus`);

      if (verification.verified) {
        // Learn and record resolution
        const learned = {
          target: entityName,
          goalType: 'internal_capability',
          successfulStrategy: `engineering_repair:${verb}:${entityType}`,
          surface: surfaceToVerify,
          parameters: { entityId, entityType, verb, target },
          verificationMethod: verification.method,
          confidence: 1.0,
          learnedAt: new Date().toISOString(),
        };
        repairKnowledgeStore.recordResolution(learned);
        goalLifecycleManager.recordLearnedResolution(goalId, learned);
        goalLifecycleManager.recordVerification(goalId, verification);

        const completionMsg = `Repaired and completed ${entityName}.`;
        goalLifecycleManager.transitionState(goalId, 'COMPLETED', {
          actor: 'Argus',
          summary: completionMsg,
          detail: verification,
        });

        onActionProgress?.({
          actionName: `Repaired & Completed ${entityName}`,
          targetCapability: 'engineering',
          status: 'completed',
          stage: 'COMPLETED',
          currentStep: completionMsg,
          goalId,
          incidentId,
        });

        return {
          success: true,
          status: 'COMPLETED',
          finalResponseText: completionMsg,
          verification,
          incidentId,
        };
      }
    }

    // Terminal failure
    const failureMsg = `Autonomous recovery exhausted for "${goal.originalUserInput}". ${repairResult.error || 'Verification failed.'}`;
    goalLifecycleManager.transitionState(goalId, 'FAILED_EXHAUSTED', {
      actor: 'ControlPlane',
      summary: failureMsg,
    });

    onActionProgress?.({
      actionName: `Recovery Failed: ${entityName}`,
      targetCapability: 'engineering',
      status: 'failed',
      stage: 'FAILED_EXHAUSTED',
      currentStep: failureMsg,
      goalId,
      incidentId,
    });

    return {
      success: false,
      status: 'FAILED_EXHAUSTED',
      finalResponseText: failureMsg,
      incidentId,
    };
  }
}

export const autonomousRecoveryEngine = AutonomousRecoveryEngine.getInstance();
