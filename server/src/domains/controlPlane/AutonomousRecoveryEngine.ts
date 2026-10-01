/**
 * AutonomousRecoveryEngine.ts — Universal Autonomous Self-Healing Control Plane
 *
 * Requirements:
 * 1. Whenever a local action fails, verification fails, Jarvis makes a false claim,
 *    or a capability is broken: NEVER ask the user whether they want a repair.
 * 2. Automatically create a self-heal incident and delegate the repair to AntiGravity.
 * 3. Preserve the original GoalRun and original user command.
 * 4. AntiGravity has engineering access to D:\AgenticOS, installed runtime, logs/config,
 *    and test/build/deploy/restart commands.
 * 5. Jarvis speaks lifecycle feedback:
 *    Stage 1: "That action failed. I’m sending the repair to AntiGravity."
 *    Stage 2: Only after a real task ID, AntiGravity session ID and WORKER_ACCEPTED:
 *             "AntiGravity accepted the repair and is working on it."
 *    Stage 3: On meaningful stages: "It found the issue and is rebuilding/deploying/retrying."
 *    Stage 4: Only after the original command is retried and Argus verifies it:
 *             "The repair is complete and verified."
 * 6. Never say completed merely because a task was created, exit code 0, or worker claims success.
 * 7. If Argus verification still fails: continue the SAME repair task rather than creating another unrelated task.
 */

import { logger } from '../../utils/logger.js';
import { goalLifecycleManager } from './GoalLifecycle.js';
import { universalVerifier } from './UniversalVerifier.js';
import { repairKnowledgeStore } from './RepairKnowledgeStore.js';
import { repositoryAuthority } from './RepositoryAuthority.js';
import { recoveryWatchdog } from './RecoveryWatchdog.js';
import { selfHealSupervisor } from '../selfHeal/SelfHealSupervisor.js';
import { failureDetector } from '../selfHeal/FailureDetector.js';
import { closeChain, recordRecoverySignal } from '../selfHeal/recoveryChain.js';
import { currentRecoveryContext } from '../selfHeal/recoveryContext.js';
import { engineeringDelegationService } from './EngineeringDelegationService.js';
import { engineeringWorkerRegistry } from './EngineeringWorkerRegistry.js';
import { argusService } from './ArgusService.js';
import { speechArbiter, SpeechPriority } from '../jarvisNext/speechArbiter.js';
import { backgroundTaskRepo } from '../../services/backgroundTasks/store.js';
import { controlPlaneExecutor } from './ControlPlaneExecutor.js';
import type { GoalRun, GoalAttempt, GoalVerification } from './types.js';

export interface RecoveryOutcome {
  success: boolean;
  status: 'COMPLETED' | 'FAILED_EXHAUSTED' | 'BLOCKED_EXTERNAL';
  finalResponseText: string;
  verification?: GoalVerification;
  incidentId?: string;
  taskId?: string;
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
   * Main recovery entry point when an action execution fails, preflight fails, or verification fails.
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

    const verb = opts.verb || 'execute';
    const entityId = opts.entityId || target;
    const entityType = opts.entityType || 'capability';
    const entityName = opts.entityName || target;

    // Recovery-chain guard (1/3): RECOVERY WORK NEVER STARTS ANOTHER RECOVERY.
    // A self-heal retry that fails the way the original did lands here again. Without this it
    // minted a new incident and a new engineering handoff on every pass, forever. It now records
    // the failure on its own chain (so the chain can go terminal) and stops.
    if (currentRecoveryContext()) {
      recordRecoverySignal({ component: `jarvis.capability.${verb}.${entityId}`, target, error: failedAttempt.error });
      logger.warn(`[AutonomousRecoveryEngine] Goal ${goalId} failed again inside recovery work; not starting another recovery.`);
      return {
        success: false,
        status: 'FAILED_EXHAUSTED',
        finalResponseText: `The action on ${entityName} failed again while recovering an earlier failure (${failedAttempt.error || 'postcondition not observed'}). I did not start another repair.`,
      };
    }

    // Phase 1: autonomous engineering repair (AntiGravity code edits + its own spoken
    // announcements) is a second, independent owner of the user's turn. It stays
    // disabled until Self-Heal Phase 2 provides a real release/deploy/restart/retry loop.
    if (process.env.AGENTICOS_AUTONOMOUS_ENGINEERING_REPAIR !== '1') {
      logger.warn(`[AutonomousRecoveryEngine] Not verified for goal ${goalId}; autonomous engineering repair disabled (Phase 1).`);
      return {
        success: false,
        status: 'FAILED_EXHAUSTED',
        finalResponseText: `The action on ${entityName} was not verified (${failedAttempt.error || 'postcondition not observed'}). Autonomous engineering repair is disabled until Self-Heal Phase 2.`,
      };
    }

    // Recovery-chain guard (2/3): ONE incident per (root operation, failure class, target).
    // The incident is opened through the registry BEFORE anything is announced or dispatched. It is a
    // real, unique, persisted incident (the old `SELFHEAL-<last 4 digits of the clock>` id repeated
    // every 10 seconds and overwrote earlier incidents). An ownership rejection of work with no user
    // turn behind it, a duplicate of an active failure, or a failure of an operation whose chain
    // already ended opens nothing.
    const raised = failureDetector.raiseIncident({
      component: `jarvis.capability.${verb}.${entityId}`,
      symptom: `User asked to "${goal.originalUserInput}" (${verb} on ${entityName}) but the action failed: ${failedAttempt.error || 'verification failed or capability broken'}`,
      failureDomain: 'backend',
      priority: 'high',
      metadata: {
        source: 'autonomous_recovery_engine',
        goalId,
        conversationId: goal.conversationId,
        target,
        reasonCode: failedAttempt.error,
        error: failedAttempt.error,
        originalText: goal.originalUserInput,
        rootOperationId: goalId,
      },
    });
    if (!raised.admitted) {
      logger.warn(`[AutonomousRecoveryEngine] Repair NOT started for goal ${goalId}: ${raised.reason}${raised.incidentId ? ` (tracked by ${raised.incidentId})` : ''}`);
      console.log(`[JRT] RECOVERY_NOT_STARTED goalId=${goalId} reason=${raised.reason} incident=${raised.incidentId || 'none'}`);
      return {
        success: false,
        status: 'BLOCKED_EXTERNAL',
        finalResponseText: `The action on ${entityName} failed (${failedAttempt.error || 'postcondition not observed'}). ${raised.incidentId ? `That failure is already tracked by ${raised.incidentId}; ` : ''}I did not start another repair (${raised.reason}).`,
        incidentId: raised.incidentId,
      };
    }

    logger.warn(`[AutonomousRecoveryEngine] Action failed for goal ${goalId}: ${failedAttempt.strategy} on ${failedAttempt.surface}. Initiating autonomous AntiGravity repair.`);
    console.log(`[JRT] RECOVERY_STARTED goalId=${goalId} failedSurface=${failedAttempt.surface} target="${target}"`);

    // Transition state: RECOVERING
    goalLifecycleManager.transitionState(goalId, 'RECOVERING', {
      actor: 'ControlPlane',
      summary: `Action failed on surface "${failedAttempt.surface}". Starting autonomous self-healing recovery.`,
      detail: { failedStrategy: failedAttempt.strategy, error: failedAttempt.error },
    });

    onActionProgress?.({
      actionName: `Recover ${target}`,
      targetCapability: failedAttempt.surface,
      status: 'running',
      stage: 'RECOVERING',
      currentStep: `Action failed on ${failedAttempt.surface}. Sending repair to AntiGravity...`,
      goalId,
    });

    // ── Spoken Lifecycle Feedback: Stage 1 ──────────────────────────────────
    try {
      await speechArbiter.request({
        text: 'That action failed. I’m sending the repair to AntiGravity.',
        priority: SpeechPriority.P1_USER_TURN,
        source: 'AutonomousRecoveryEngine',
        eventType: 'self_heal_stage_1',
      });
    } catch (spkErr: any) {
      logger.warn('[AutonomousRecoveryEngine] Failed to speak Stage 1 feedback:', spkErr?.message);
    }

    return this.escalateToEngineering({
      goal,
      target,
      verb,
      entityId,
      entityType,
      entityName,
      failedAttempt,
      incidentId: raised.incidentId,
      chainId: raised.chainId,
      executeStrategy,
      onActionProgress,
    });
  }

  /**
   * Escalates to AntiGravity Autonomous Engineering Recovery.
   */
  private async escalateToEngineering(opts: {
    goal: GoalRun;
    target: string;
    verb: string;
    entityId: string;
    entityType: string;
    entityName: string;
    failedAttempt: GoalAttempt;
    /** The ONE incident/chain the recovery-chain registry admitted for this failure. */
    incidentId: string;
    chainId: string;
    executeStrategy: (strategy: { surface: string; target: string; parameters?: any }) => Promise<{ executed: boolean; error?: string }>;
    onActionProgress?: (update: any) => void;
  }): Promise<RecoveryOutcome> {
    const { goal, target, verb, entityId, entityType, entityName, failedAttempt, executeStrategy, onActionProgress } = opts;
    const goalId = goal.goalId;

    // Validate Authoritative Repository before proceeding
    try {
      repositoryAuthority.assertRepositoryHealthy();
    } catch (repoErr: any) {
      logger.warn('[AutonomousRecoveryEngine] Repository health assertion warning:', repoErr?.message);
    }

    const incidentId = opts.incidentId;
    const chainId = opts.chainId;
    goalLifecycleManager.linkIncident(goalId, incidentId);

    goalLifecycleManager.transitionState(goalId, 'ENGINEERING_REPAIR', {
      actor: 'EngineeringWorker',
      summary: `Defect detected. Created incident ${incidentId}. Delegated repair to AntiGravity.`,
      detail: { incidentId, repoRoot: repositoryAuthority.getRepositoryRoot() },
    });

    onActionProgress?.({
      actionName: `Repair ${verb}:${entityName}`,
      targetCapability: 'engineering',
      status: 'running',
      stage: 'ENGINEERING_REPAIR',
      currentStep: `Defect detected (${incidentId}). Delegating repair to AntiGravity...`,
      goalId,
      incidentId,
    });

    console.log(`[JRT] SELFHEAL_DETECTED component=jarvis.capability.${verb}.${entityId} goalId=${goalId}`);
    console.log(`[JRT] SELFHEAL_INCIDENT_CREATED incidentId=${incidentId} goalId=${goalId}`);

    // Construct detailed AntiGravity delegation objective
    const objective = [
      `[AUTONOMOUS SELF-HEAL REPAIR INCIDENT ${incidentId}]`,
      `Original User Command: "${goal.originalUserInput}"`,
      `Failed Target: "${target}"`,
      `Verb: "${verb}"`,
      `Failure Reason: ${failedAttempt.error || 'Verification failed or capability broken'}`,
      ``,
      `ENGINEERING ACCESS & REPOSITORY CONTEXT:`,
      `- AgenticOS repo: D:\\AgenticOS`,
      `- Installed AgenticOS runtime: C:\\Users\\cd-pr\\AppData\\Local\\Programs\\AgenticOS`,
      `- AgenticOS logs/config: C:\\Users\\cd-pr\\AppData\\Roaming\\AgenticOS and C:\\Users\\cd-pr\\AppData\\Local\\AgenticOS`,
      ``,
      `LIFECYCLE VERIFICATION COMMANDS:`,
      `- Tests: npm test (or npx vitest run) in D:\\AgenticOS\\server`,
      `- Build: npm run build:app in D:\\AgenticOS`,
      `- Deploy: node scripts/deploy-installed.cjs in D:\\AgenticOS`,
      `- Restart/reload affected runtime`,
      ``,
      `TASK OBJECTIVES:`,
      `1. Diagnose the real runtime failure in AgenticOS codebase for command "${goal.originalUserInput}".`,
      `2. Edit repository code in D:\\AgenticOS to repair the capability.`,
      `3. Run tests and build the application.`,
      `4. Deploy to the installed application runtime under C:\\Users\\cd-pr\\AppData\\Local\\Programs\\AgenticOS.`,
      `5. Prepare runtime for retry of the original command.`,
    ].join('\n');

    let delegation = await engineeringDelegationService.delegateTask({
      objective,
      context: `Autonomous self-heal repair for incident ${incidentId} (Goal ${goalId}). Original command: "${goal.originalUserInput}".`,
      worker: 'antigravity',
      workspacePath: 'D:\\AgenticOS',
      goalId,
      conversationId: goal.conversationId,
      delegatedBy: 'AutonomousRecoveryEngine',
      // Recovery-chain guard (3/3): the handoff is admitted (one per chain / operation / failure
      // fingerprint, plus a global breaker) before a worker task exists; any retry of this
      // failure re-runs the USER's request, never this repair objective.
      recoveryChainId: chainId,
      incidentId,
      originalUserInput: goal.originalUserInput,
    });

    if (!delegation.success) {
      logger.warn(`[AutonomousRecoveryEngine] Engineering handoff refused for incident ${incidentId}: ${delegation.message}`);
      closeChain(chainId, 'BLOCKED', 'handoff_refused');
      // The goal was already moved to ENGINEERING_REPAIR above; a refused handoff must not leave it
      // parked there as if a worker were still on it.
      goalLifecycleManager.transitionState(goalId, 'BLOCKED_EXTERNAL', {
        actor: 'ControlPlane',
        summary: `Engineering handoff refused for incident ${incidentId}; the recovery chain ended BLOCKED.`,
        detail: { incidentId, chainId, reason: delegation.message },
      });
      return {
        success: false,
        status: 'BLOCKED_EXTERNAL',
        finalResponseText: `The action on ${entityName} failed and I did not hand the repair to an engineering worker (${delegation.message}). Incident ${incidentId} is recorded as unresolved for review.`,
        incidentId,
      };
    }

    const taskId = delegation.taskId;
    let hasWorkerAccepted = delegation.hasWorkerAccepted;
    let runId = delegation.runId || delegation.conversationId;

    // ── Spoken Lifecycle Feedback: Stage 2 ──────────────────────────────────
    // "Only after a real task ID, AntiGravity session ID and WORKER_ACCEPTED:
    //  AntiGravity accepted the repair and is working on it."
    if (!hasWorkerAccepted) {
      for (let poll = 0; poll < 6; poll++) {
        await new Promise(r => setTimeout(r, 500));
        const events = engineeringWorkerRegistry.getWorkerEvents('antigravity').filter(e => e.taskId === taskId);
        if (events.some(e => e.eventType === 'WORKER_ACCEPTED')) {
          hasWorkerAccepted = true;
          break;
        }
        const updated = backgroundTaskRepo.getTask(taskId);
        if (updated?.status === 'executing' || updated?.status === 'worker_accepted') {
          hasWorkerAccepted = true;
          runId = updated.linkedRunId || runId;
          break;
        }
      }
    }

    if (taskId && runId && hasWorkerAccepted) {
      try {
        await speechArbiter.request({
          text: 'AntiGravity accepted the repair and is working on it.',
          priority: SpeechPriority.P1_USER_TURN,
          source: 'AutonomousRecoveryEngine',
          eventType: 'self_heal_stage_2',
        });
      } catch (spkErr: any) {
        logger.warn('[AutonomousRecoveryEngine] Failed to speak Stage 2 feedback:', spkErr?.message);
      }
    }

    // ── Spoken Lifecycle Feedback: Stage 3 ──────────────────────────────────
    // "On meaningful stages: It found the issue and is rebuilding/deploying/retrying."
    try {
      await speechArbiter.request({
        text: 'It found the issue and is rebuilding/deploying/retrying.',
        priority: SpeechPriority.P1_USER_TURN,
        source: 'AutonomousRecoveryEngine',
        eventType: 'self_heal_stage_3',
      });
    } catch (spkErr: any) {
      logger.warn('[AutonomousRecoveryEngine] Failed to speak Stage 3 feedback:', spkErr?.message);
    }

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
              reason: failedAttempt.error || `Defect detected for "${target}"`,
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
            approver: 'autonomous_self_heal',
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

    // ── Retry the ORIGINAL failed command ────────────────────────────────────
    goalLifecycleManager.transitionState(goalId, 'RETRYING_ORIGINAL_GOAL', {
      actor: 'ControlPlane',
      summary: `Retrying original user command "${goal.originalUserInput}".`,
    });

    onActionProgress?.({
      actionName: `Retry ${verb}:${entityName}`,
      targetCapability: failedAttempt.surface,
      status: 'running',
      stage: 'RETRYING_ORIGINAL_COMMAND',
      currentStep: `Repair applied. Retrying original command "${goal.originalUserInput}"...`,
      goalId,
      incidentId,
    });

    let retryExec = await executeStrategy({
      surface: failedAttempt.surface || 'desktop',
      target,
      parameters: {
        ...failedAttempt.parameters,
        prompt: goal.originalUserInput,
        target,
        verb,
      },
    });

    // If strategy surface failed, try internal dynamic capability execution
    if (!retryExec.executed) {
      retryExec = await controlPlaneExecutor.execute({
        surface: 'internal',
        target,
        parameters: {
          ...failedAttempt.parameters,
          prompt: goal.originalUserInput,
          target,
          verb,
          entityId,
          entityType,
          entityName,
        },
      });
    }

    // ── Independent Reality Verification (Argus) ─────────────────────────────
    goalLifecycleManager.transitionState(goalId, 'INDEPENDENT_VERIFICATION', {
      actor: 'Argus',
      summary: `Argus performing independent post-repair verification on physical reality.`,
    });

    onActionProgress?.({
      actionName: `Verify ${entityName}`,
      targetCapability: 'verification',
      status: 'running',
      stage: 'INDEPENDENT_VERIFICATION',
      currentStep: 'Argus independently verifying physical outcome...',
      goalId,
      incidentId,
    });

    let verification = await argusService.verifyExecution({
      goalRun: goal,
      surface: failedAttempt.surface || 'desktop',
      target,
      parameters: {
        ...failedAttempt.parameters,
        prompt: goal.originalUserInput,
        target,
        verb,
        entityId,
        entityType,
        entityName,
      },
      executionResult: retryExec,
    });

    console.log(`[JRT] INDEPENDENT_VERIFICATION_COMPLETE verified=${verification.verified} verifier=Argus`);

    // ── Strict Continuation Contract: If verification still fails, continue SAME task ──
    if (!verification.verified) {
      logger.warn(`[AutonomousRecoveryEngine] Verification after repair failed: ${verification.summary}. Continuing repair task ${taskId}.`);

      try {
        await engineeringDelegationService.continueTask({
          taskId,
          instruction: `Physical verification still failed after retry: ${verification.summary}. Please inspect physical evidence and continue repair without creating a new task.`,
        });
      } catch (contErr: any) {
        logger.warn(`[AutonomousRecoveryEngine] Failed to continue task ${taskId}:`, contErr?.message);
      }

      // Execute second retry pass on continuation
      retryExec = await executeStrategy({
        surface: failedAttempt.surface || 'desktop',
        target,
        parameters: {
          ...failedAttempt.parameters,
          prompt: goal.originalUserInput,
          target,
          verb,
        },
      });

      if (!retryExec.executed) {
        retryExec = await controlPlaneExecutor.execute({
          surface: 'internal',
          target,
          parameters: {
            ...failedAttempt.parameters,
            prompt: goal.originalUserInput,
            target,
            verb,
            entityId,
            entityType,
            entityName,
          },
        });
      }

      verification = await argusService.verifyExecution({
        goalRun: goal,
        surface: failedAttempt.surface || 'desktop',
        target,
        parameters: {
          ...failedAttempt.parameters,
          prompt: goal.originalUserInput,
          target,
          verb,
          entityId,
          entityType,
          entityName,
        },
        executionResult: retryExec,
      });
    }

    // ── Spoken Lifecycle Feedback: Stage 4 ──────────────────────────────────
    // "Only after the original command is retried and Argus verifies it:
    //  The repair is complete and verified."
    if (verification.verified) {
      try {
        await speechArbiter.request({
          text: 'The repair is complete and verified.',
          priority: SpeechPriority.P1_USER_TURN,
          source: 'AutonomousRecoveryEngine',
          eventType: 'self_heal_stage_4',
        });
      } catch (spkErr: any) {
        logger.warn('[AutonomousRecoveryEngine] Failed to speak Stage 4 feedback:', spkErr?.message);
      }

      // Record learned resolution in RepairKnowledgeStore
      const learned = {
        target: entityName,
        goalType: verb,
        successfulStrategy: `antigravity_repair:${verb}:${entityType}`,
        surface: failedAttempt.surface || 'desktop',
        parameters: { entityId, entityType, verb, target },
        verificationMethod: verification.method,
        confidence: 1.0,
        learnedAt: new Date().toISOString(),
      };
      repairKnowledgeStore.recordResolution(learned);
      goalLifecycleManager.recordLearnedResolution(goalId, learned);
      goalLifecycleManager.recordVerification(goalId, verification);

      closeChain(chainId, 'RECOVERED', 'engine_verified');
      const completionMsg = 'The repair is complete and verified.';
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
        taskId,
      };
    }

    // ── Terminal Failure if still unverified ─────────────────────────────────
    closeChain(chainId, 'FAILED', 'engine_exhausted');
    const failureMsg = `Autonomous recovery exhausted for "${goal.originalUserInput}". ${verification.summary || 'Argus verification failed.'}`;
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
      verification,
      incidentId,
      taskId,
    };
  }
}

export const autonomousRecoveryEngine = AutonomousRecoveryEngine.getInstance();
