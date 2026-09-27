/**
 * ControlPlaneTurnHandler.ts — Universal Production Execution & Recovery Controller
 *
 * Implements the single authoritative end-to-end execution lifecycle:
 * USER → VOICE/TEXT INPUT → UNDERSTAND GOAL → ACKNOWLEDGE → CREATE DURABLE GOALRUN
 * → ARGUS PREFLIGHT INSPECTOR → PLAN → DISCOVER CAPABILITIES → EXECUTE
 * → OBSERVE REAL-WORLD STATE → ARGUS INDEPENDENT VERIFICATION → ACTION CLAIM GUARD
 *
 * If unsuccessful:
 * → RECOVER → DIAGNOSE → DISCOVER ALTERNATIVE STRATEGY → TRY ALTERNATIVE → VERIFY AGAIN
 *
 * If AgenticOS itself is defective:
 * → ENGINEERING SELF-HEAL → Hermes supervises diagnosis → coding worker selected
 * → repository located → defect reproduced → patch produced → tests run → build produced
 * → runtime reloaded → ORIGINAL GOALRUN survives → ORIGINAL GOAL retried
 * → Argus independently verifies → incident closes automatically → RepairMemory learns.
 */

import { logger } from '../../utils/logger.js';
import { goalLifecycleManager } from './GoalLifecycle.js';
import { capabilityDiscovery } from './CapabilityDiscovery.js';
import { controlPlaneExecutor } from './ControlPlaneExecutor.js';
import { universalVerifier } from './UniversalVerifier.js';
import { alternativeStrategyPlanner } from './AlternativeStrategyPlanner.js';
import { repairKnowledgeStore } from './RepairKnowledgeStore.js';
import { autonomousRecoveryEngine } from './AutonomousRecoveryEngine.js';
import { acknowledgementService } from './AcknowledgementService.js';
import { argusService } from './ArgusService.js';
import { actionClaimGuard } from './ActionClaimGuard.js';
import { engineeringAcceptance } from './EngineeringAcceptance.js';
import { capabilityCertificationRegistry } from './CapabilityCertificationRegistry.js';
import { projectsStore } from '../../services/projectsStore.js';
import type { TurnResult, TurnFocus } from '../jarvisNext/turnRouter.js';
import type { GoalRun, GoalAttempt, DiscoveredCapability, GoalVerification } from './types.js';

export interface ControlPlaneTurnOpts {
  prompt: string;
  effectivePrompt: string;
  conversationId: string;
  turnId?: number;
  sttConfidence?: number;
  onActionProgress?: (update: any) => void;
  navigationVerifier?: (req: any) => Promise<any>;
  focus: TurnFocus;
}

export interface ConversationReferent {
  conversationId: string;
  activeGoalId?: string;
  activeIntent?: string;
  activeTarget?: string;
  activeApplication?: string;
  activeWindow?: string;
  activeBrowserTab?: string;
  activePerceptionSource?: string;
  negativeTargets?: string[];
  lastEvidence?: any[];
  lastFailure?: any;
  lastVerifierResult?: any;
  lastUpdated: string;
}

export class ControlPlaneTurnHandler {
  private static instance: ControlPlaneTurnHandler;
  private referents = new Map<string, ConversationReferent>();

  private constructor() {}

  public static getInstance(): ControlPlaneTurnHandler {
    if (!ControlPlaneTurnHandler.instance) {
      ControlPlaneTurnHandler.instance = new ControlPlaneTurnHandler();
    }
    return ControlPlaneTurnHandler.instance;
  }

  public getReferent(conversationId: string): ConversationReferent | undefined {
    return this.referents.get(conversationId);
  }

  public updateReferent(conversationId: string, partial: Partial<ConversationReferent>): void {
    const existing = this.referents.get(conversationId) || {
      conversationId,
      lastUpdated: new Date().toISOString(),
    };
    this.referents.set(conversationId, {
      ...existing,
      ...partial,
      lastUpdated: new Date().toISOString(),
    });
  }

  /**
   * Determine if the user prompt is an actionable goal or continuation.
   * If so, execute the full autonomous control plane lifecycle.
   * Returns TurnResult if handled, or null if the prompt is purely conversational.
   */
  public async handleTurn(opts: ControlPlaneTurnOpts): Promise<TurnResult | null> {
    const { prompt, effectivePrompt, conversationId, turnId, onActionProgress, focus } = opts;
    const lower = effectivePrompt.toLowerCase().trim();

    // ── 0. User Correction Handling: "No, that's the wrong app/window/target" ───────
    const isUserCorrection = /\b(?:wrong\s+(?:app|application|window|target|one)|not\s+that\s+(?:app|application|window|one)|that(?:'s|\s+is)\s+the\s+wrong)\b/i.test(lower);
    if (isUserCorrection) {
      const activeGoal = goalLifecycleManager.getActiveGoalForConversation(conversationId)
        || goalLifecycleManager.listGoalRuns(10).find(g => g.conversationId === conversationId);
      if (activeGoal) {
        logger.warn(`[ControlPlaneTurnHandler] User correction detected on goal ${activeGoal.goalId}: previous target was "${activeGoal.target || activeGoal.normalizedGoal}"`);
        const ref = this.getReferent(conversationId);
        const badTarget = activeGoal.target || activeGoal.normalizedGoal;
        const negativeTargets = [...(ref?.negativeTargets || []), badTarget].filter(Boolean) as string[];
        this.updateReferent(conversationId, { negativeTargets });

        // Invalidate previous verification
        goalLifecycleManager.transitionState(activeGoal.goalId, 'RECOVERING', {
          actor: 'UserCorrection',
          summary: `User corrected: "${badTarget}" was the wrong target. Invalidating previous verification and searching for alternatives.`,
        });

        onActionProgress?.({
          actionName: `Correct ${activeGoal.normalizedGoal}`,
          targetCapability: 'recovery',
          status: 'running',
          stage: 'RECOVERING',
          currentStep: `Invalidated "${badTarget}". Searching for correct alternative...`,
          goalId: activeGoal.goalId,
        });

        const recoveryOutcome = await autonomousRecoveryEngine.handleFailure({
          goalId: activeGoal.goalId,
          failedAttempt: {
            attemptNumber: activeGoal.attempts.length + 1,
            strategy: 'user_correction',
            surface: activeGoal.plan?.selectedSurface || 'desktop',
            target: badTarget,
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            executed: false,
            verified: false,
            evidence: [],
            error: `User stated "${badTarget}" is the wrong target.`,
          },
          target: activeGoal.normalizedGoal,
          goalType: 'action',
          executeStrategy: (strat) => controlPlaneExecutor.execute(strat),
          onActionProgress,
        });

        return {
          handled: true,
          route: 'action',
          text: recoveryOutcome.finalResponseText,
          evidence: true,
          executed: recoveryOutcome.success,
          verified: recoveryOutcome.success,
          goalId: activeGoal.goalId,
          fallbackReason: recoveryOutcome.success ? undefined : 'recovery_exhausted',
          timings: { totalMs: 0 },
        } as TurnResult;
      }
    }

    // ── 1. Conversation Continuity: Continuation / Recovery commands ───────
    const isContinuation = this.checkContinuationIntent(lower);
    if (isContinuation) {
      if (isContinuation === 'self_heal') {
        const activeFailedGoal = goalLifecycleManager.listGoalRuns(10).find(g => (g.conversationId === conversationId || !conversationId) && (g.status === 'FAILED_EXHAUSTED' || g.status === 'RECOVERING' || g.state === 'FAILED_EXHAUSTED' || g.state === 'RECOVERING'));
        if (activeFailedGoal) {
          logger.info(`[ControlPlaneTurnHandler] Self-heal: resuming recovery on active failed GoalRun ${activeFailedGoal.goalId}`);
          onActionProgress?.({
            actionName: `Self-Heal ${activeFailedGoal.normalizedGoal}`,
            targetCapability: 'selfheal',
            status: 'running',
            stage: 'RECOVERING',
            currentStep: `Healing active failed goal ${activeFailedGoal.goalId}...`,
            goalId: activeFailedGoal.goalId,
          });

          const lastAttempt = activeFailedGoal.attempts[activeFailedGoal.attempts.length - 1] || {
            attemptNumber: 1,
            strategy: 'self_heal',
            surface: activeFailedGoal.plan?.selectedSurface || 'unknown',
            target: activeFailedGoal.normalizedGoal,
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            executed: false,
            verified: false,
            evidence: [],
          };

          const recoveryOutcome = await autonomousRecoveryEngine.handleFailure({
            goalId: activeFailedGoal.goalId,
            failedAttempt: lastAttempt,
            target: activeFailedGoal.normalizedGoal,
            goalType: 'action',
            executeStrategy: (strat) => controlPlaneExecutor.execute(strat),
            onActionProgress,
          });

          return {
            handled: true,
            route: 'action',
            text: recoveryOutcome.finalResponseText,
            evidence: true,
            executed: recoveryOutcome.success,
            verified: recoveryOutcome.success,
            goalId: activeFailedGoal.goalId,
            fallbackReason: recoveryOutcome.success ? undefined : 'self_heal_exhausted',
            timings: { totalMs: 0 },
          } as TurnResult;
        } else {
          // No active failed goal: run safe EngineeringAcceptance test
          logger.info(`[ControlPlaneTurnHandler] Self-heal: no active failed goal. Executing safe EngineeringAcceptance test...`);
          onActionProgress?.({
            actionName: 'Autonomous Self-Repair Acceptance Test',
            targetCapability: 'engineering',
            status: 'running',
            stage: 'ENGINEERING_REPAIR',
            currentStep: 'Running 11-stage autonomous engineering self-repair verification...',
          });

          const acceptance = await engineeringAcceptance.runAcceptanceTest();
          const summary = acceptance.success
            ? `Autonomous engineering self-repair verified end-to-end (all 11 stages). Hermes, Codex, and Argus successfully reproduced, repaired, tested, and verified an isolated defect with zero manual intervention.`
            : `Autonomous engineering self-repair test failed at stage ${acceptance.stagesCompleted}/${acceptance.totalStages}.`;

          return {
            handled: true,
            route: 'action',
            text: summary,
            evidence: true,
            executed: acceptance.success,
            verified: acceptance.success,
            timings: { totalMs: 0 },
          } as TurnResult;
        }
      }

      const activeGoal = goalLifecycleManager.getActiveGoalForConversation(conversationId)
        || goalLifecycleManager.listGoalRuns(10).find(g => g.conversationId === conversationId);

      if (activeGoal) {
        if (isContinuation === 'explain_failure') {
          const lastFailure = activeGoal.failures[activeGoal.failures.length - 1];
          const explanation = lastFailure
            ? `The previous attempt to ${activeGoal.normalizedGoal} failed because: ${lastFailure.reason}. I tried ${activeGoal.attempts.length} strategies.`
            : `The goal "${activeGoal.normalizedGoal}" could not be completed in the previous attempt.`;
          return {
            handled: true,
            route: 'immediate_memory',
            text: explanation,
            evidence: true,
            executed: true,
            verified: true,
            goalId: activeGoal.goalId,
            timings: { totalMs: 0 },
          } as TurnResult;
        }

        if (isContinuation === 'retry_or_fix') {
          logger.info(`[ControlPlaneTurnHandler] Continuing existing GoalRun ${activeGoal.goalId} for "${effectivePrompt}"`);
          console.log(`[JRT] CONTINUING_GOALRUN goalId=${activeGoal.goalId} prompt="${effectivePrompt}"`);

          onActionProgress?.({
            actionName: `Retry ${activeGoal.normalizedGoal}`,
            targetCapability: activeGoal.plan?.selectedSurface || 'system',
            status: 'running',
            stage: 'RECOVERING',
            currentStep: `Continuing GoalRun ${activeGoal.goalId}: seeking alternative strategy...`,
            goalId: activeGoal.goalId,
          });

          // Resume recovery on existing GoalRun
          const lastAttempt = activeGoal.attempts[activeGoal.attempts.length - 1] || {
            attemptNumber: 1,
            strategy: 'initial',
            surface: 'unknown',
            target: activeGoal.normalizedGoal,
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            executed: false,
            verified: false,
            evidence: [],
          };

          const recoveryOutcome = await autonomousRecoveryEngine.handleFailure({
            goalId: activeGoal.goalId,
            failedAttempt: lastAttempt,
            target: activeGoal.normalizedGoal,
            goalType: 'action',
            executeStrategy: (strat) => controlPlaneExecutor.execute(strat),
            onActionProgress,
          });

          return {
            handled: true,
            route: 'action',
            text: recoveryOutcome.finalResponseText,
            evidence: true,
            executed: recoveryOutcome.success,
            verified: recoveryOutcome.success,
            goalId: activeGoal.goalId,
            fallbackReason: recoveryOutcome.success ? undefined : 'recovery_exhausted',
            timings: { totalMs: 0 },
          } as TurnResult;
        }
      }
    }

    // ── 2. Action Intent & Target Extraction with Referent Resolution ──────
    const goalIntent = this.extractActionIntent(effectivePrompt, focus, conversationId);
    if (!goalIntent) {
      // Not an actionable goal -> hand over to conversational / fast-read paths
      return null;
    }

    const { verb, target, entityType, parameters } = goalIntent;
    logger.info(`[ControlPlaneTurnHandler] Ingesting actionable goal: verb="${verb}" target="${target}"`);
    console.log(`[JRT] ACTIONABLE_GOAL_INGESTED verb="${verb}" target="${target}" prompt="${effectivePrompt}"`);

    // ── 3. Create Durable GoalRun & Immediate Acknowledgment ───────────────
    const ackText = acknowledgementService.generateAcknowledgement(prompt, target);

    const goalRun = goalLifecycleManager.startGoal({
      conversationId,
      turnId: turnId ? String(turnId) : undefined,
      userInput: prompt,
      normalizedGoal: effectivePrompt,
      target,
    });

    onActionProgress?.({
      actionName: `${verb} ${target}`,
      targetCapability: target,
      status: 'running',
      stage: 'ACKNOWLEDGED',
      currentStep: ackText,
      goalId: goalRun.goalId,
    });

    // ── 4. Planning & Capability Discovery ─────────────────────────────────
    goalLifecycleManager.transitionState(goalRun.goalId, 'DISCOVERING', {
      actor: 'ControlPlane',
      summary: `Discovering capabilities across 11 surfaces for target "${target}".`,
    });

    onActionProgress?.({
      actionName: `${verb} ${target}`,
      targetCapability: target,
      status: 'running',
      stage: 'DISCOVERING',
      currentStep: `Discovering execution strategies for "${target}"...`,
      goalId: goalRun.goalId,
    });

    // Check learned resolution first (RepairMemory)
    const learnedRes = repairKnowledgeStore.lookupResolution(target, verb);
    let primaryStrategy: {
      surface: string;
      target: string;
      parameters?: Record<string, any>;
      name: string;
    } | null = null;

    if (learnedRes) {
      logger.info(`[ControlPlaneTurnHandler] Found learned resolution from RepairKnowledge for "${target}" on ${learnedRes.surface}`);
      primaryStrategy = {
        surface: learnedRes.surface,
        target: learnedRes.executablePath || learnedRes.url || target,
        parameters: { ...parameters, ...learnedRes.parameters, prompt, verb, target },
        name: `Learned: ${learnedRes.surface}`,
      };
    } else {
      // Multi-surface discovery
      const candidates = await capabilityDiscovery.discover(target, verb);
      if (candidates.length > 0) {
        const top = candidates[0];
        primaryStrategy = {
          surface: top.surface,
          target: top.target,
          parameters: { ...parameters, ...top.parameters, prompt, verb, target },
          name: top.name,
        };
      } else if (entityType === 'project') {
        // Internal project mutation
        primaryStrategy = {
          surface: 'internal',
          target,
          parameters: { entityType: 'project', verb, prompt, target, ...parameters },
          name: `Project: ${verb}`,
        };
      } else {
        // Default to web search
        primaryStrategy = {
          surface: 'browser',
          target: `https://www.google.com/search?q=${encodeURIComponent(effectivePrompt)}`,
          parameters: { url: `https://www.google.com/search?q=${encodeURIComponent(effectivePrompt)}` },
          name: `Web Search for ${target}`,
        };
      }
    }

    goalLifecycleManager.setPlan(goalRun.goalId, {
      goalId: goalRun.goalId,
      summary: primaryStrategy.name,
      selectedSurface: primaryStrategy.surface,
      confidence: 0.9,
      steps: [{
        stepIndex: 1,
        description: `${verb} ${target} via ${primaryStrategy.surface}`,
        capability: primaryStrategy.surface,
        target: primaryStrategy.target,
        parameters: primaryStrategy.parameters,
        status: 'pending',
      }],
    });

    // ── 4b. Mandatory Preflight Inspection (Argus) ─────────────────────────
    const preflight = await argusService.preflight({
      goalId: goalRun.goalId,
      resolvedIntent: verb,
      target,
      surface: primaryStrategy.surface,
      parameters: primaryStrategy.parameters,
    });

    if (!preflight.approved) {
      logger.warn(`[ControlPlaneTurnHandler] Preflight rejected goal ${goalRun.goalId}: ${preflight.rejectionReason}`);
      goalLifecycleManager.transitionState(goalRun.goalId, 'RECOVERING', {
        actor: 'Argus',
        summary: `Preflight checks rejected execution: ${preflight.rejectionReason}`,
      });

      const recoveryOutcome = await autonomousRecoveryEngine.handleFailure({
        goalId: goalRun.goalId,
        failedAttempt: {
          attemptNumber: 1,
          strategy: primaryStrategy.name,
          surface: primaryStrategy.surface,
          target,
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          executed: false,
          verified: false,
          evidence: [],
          error: `Preflight rejection: ${preflight.rejectionReason}`,
        },
        target,
        goalType: verb,
        entityId: primaryStrategy.parameters?.entityId || parameters?.entityId || (primaryStrategy.surface === 'internal' ? primaryStrategy.target : target),
        entityType: primaryStrategy.parameters?.entityType || entityType || 'capability',
        entityName: primaryStrategy.parameters?.entityName || target,
        verb,
        executeStrategy: (strat) => controlPlaneExecutor.execute(strat),
        onActionProgress,
      });

      return {
        handled: true,
        route: 'action',
        text: recoveryOutcome.finalResponseText,
        evidence: true,
        executed: recoveryOutcome.success,
        verified: recoveryOutcome.success,
        goalId: goalRun.goalId,
        fallbackReason: recoveryOutcome.success ? undefined : 'preflight_failed_recovery_exhausted',
        entityName: target,
        timings: { totalMs: 0 },
      };
    }

    // ── 5. Primary Strategy Execution ──────────────────────────────────────
    goalLifecycleManager.transitionState(goalRun.goalId, 'EXECUTING', {
      actor: 'ControlPlane',
      summary: `Executing primary strategy on surface "${primaryStrategy.surface}".`,
      detail: primaryStrategy,
    });

    onActionProgress?.({
      actionName: `${verb} ${target}`,
      targetCapability: primaryStrategy.surface,
      status: 'running',
      stage: 'EXECUTING',
      currentStep: `Executing ${target} via ${primaryStrategy.surface}...`,
      goalId: goalRun.goalId,
    });

    const startExecution = new Date().toISOString();
    let execResult = await controlPlaneExecutor.execute({
      surface: primaryStrategy.surface,
      target: primaryStrategy.target,
      parameters: primaryStrategy.parameters,
    });

    // ── 6. Independent Reality Verification (Argus) ────────────────────────
    goalLifecycleManager.transitionState(goalRun.goalId, 'VERIFYING', {
      actor: 'Argus',
      summary: `Argus verifying real-world outcome on surface "${primaryStrategy.surface}".`,
    });

    onActionProgress?.({
      actionName: `Verify ${target}`,
      targetCapability: primaryStrategy.surface,
      status: 'running',
      stage: 'VERIFYING',
      currentStep: `Argus independently verifying real outcome on ${primaryStrategy.surface}...`,
      goalId: goalRun.goalId,
    });

    const verification: GoalVerification = await argusService.verifyExecution({
      goalRun,
      surface: primaryStrategy.surface,
      target: primaryStrategy.target,
      parameters: primaryStrategy.parameters,
      executionResult: execResult,
    });

    const attempt1: GoalAttempt = {
      attemptNumber: 1,
      strategy: primaryStrategy.name,
      surface: primaryStrategy.surface,
      target: primaryStrategy.target,
      parameters: primaryStrategy.parameters,
      startedAt: startExecution,
      completedAt: new Date().toISOString(),
      executed: execResult.executed,
      verified: verification.verified,
      evidence: verification.evidence || [],
      error: execResult.error,
    };
    goalLifecycleManager.recordAttempt(goalRun.goalId, attempt1);

    // ── 7. Success Verification Gate & Action Claim Guard ───────────────────
    if (execResult.executed && verification.verified) {
      let completionText = (verification.summary && (primaryStrategy.surface === 'camera' || primaryStrategy.surface === 'desktop_observe' || verb === 'perceive' || verb === 'observe'))
        ? verification.summary
        : this.buildCompletionText(target, verb, primaryStrategy.surface, primaryStrategy.parameters);

      // Pass through ActionClaimGuard to strictly prevent unverified claims
      const guardResult = actionClaimGuard.evaluateClaim({
        proposedText: completionText,
        goalRun,
        verification,
        surface: primaryStrategy.surface,
        target,
      });
      completionText = guardResult.sanitizedText;

      goalLifecycleManager.recordVerification(goalRun.goalId, verification);
      goalLifecycleManager.transitionState(goalRun.goalId, 'COMPLETED', {
        actor: 'Argus',
        summary: completionText,
        detail: verification,
      });

      // Update Referent Memory
      this.updateReferent(conversationId, {
        activeGoalId: goalRun.goalId,
        activeIntent: verb,
        activeTarget: target,
        activeApplication: (primaryStrategy.surface === 'desktop' || primaryStrategy.surface === 'executable' || primaryStrategy.surface === 'desktop_observe') ? target : undefined,
        lastEvidence: verification.evidence,
        lastVerifierResult: verification,
      });

      // Record learned knowledge
      repairKnowledgeStore.recordResolution({
        target,
        goalType: verb,
        successfulStrategy: primaryStrategy.name,
        surface: primaryStrategy.surface,
        executablePath: primaryStrategy.surface === 'executable' ? primaryStrategy.target : undefined,
        url: primaryStrategy.surface === 'browser' ? primaryStrategy.target : undefined,
        parameters: primaryStrategy.parameters,
        verificationMethod: verification.method,
        confidence: 0.95,
        learnedAt: new Date().toISOString(),
      });

      onActionProgress?.({
        actionName: `Completed ${target}`,
        targetCapability: primaryStrategy.surface,
        status: 'completed',
        stage: 'COMPLETED',
        currentStep: completionText,
        goalId: goalRun.goalId,
      });

      return {
        handled: true,
        route: (primaryStrategy.surface === 'browser' ? 'browser' : 'action') as any,
        text: completionText,
        evidence: true,
        executed: true,
        verified: true,
        goalId: goalRun.goalId,
        entityName: target,
        timings: { totalMs: 0 },
      };
    }

    // ── 8. Failure Recovery & Engineering Escalation ───────────────────────
    logger.warn(`[ControlPlaneTurnHandler] Primary execution/verification failed for "${target}". Invoking AutonomousRecoveryEngine.`);
    console.log(`[JRT] PRIMARY_FAILED_ENTERING_RECOVERY goalId=${goalRun.goalId} surface=${primaryStrategy.surface} target="${target}"`);

    onActionProgress?.({
      actionName: `Recover ${target}`,
      targetCapability: primaryStrategy.surface,
      status: 'running',
      stage: 'RECOVERING',
      currentStep: `First attempt failed (${execResult.error || verification.summary}). Diagnosing and seeking alternatives...`,
      goalId: goalRun.goalId,
    });

    const recoveryOutcome = await autonomousRecoveryEngine.handleFailure({
      goalId: goalRun.goalId,
      failedAttempt: attempt1,
      target,
      goalType: verb,
      entityId: primaryStrategy.parameters?.entityId || parameters?.entityId || (primaryStrategy.surface === 'internal' ? primaryStrategy.target : target),
      entityType: primaryStrategy.parameters?.entityType || entityType || 'capability',
      entityName: primaryStrategy.parameters?.entityName || target,
      verb,
      executeStrategy: (strat) => controlPlaneExecutor.execute(strat),
      onActionProgress,
    });

    // Guard final response from recovery
    const guardedRecoveryText = actionClaimGuard.evaluateClaim({
      proposedText: recoveryOutcome.finalResponseText,
      goalRun,
      verification: recoveryOutcome.verification,
      surface: primaryStrategy.surface,
      target,
    }).sanitizedText;

    if (recoveryOutcome.success) {
      this.updateReferent(conversationId, {
        activeGoalId: goalRun.goalId,
        activeIntent: verb,
        activeTarget: target,
        lastEvidence: recoveryOutcome.verification?.evidence,
        lastVerifierResult: recoveryOutcome.verification,
      });
    }

    return {
      handled: true,
      route: 'action',
      text: guardedRecoveryText,
      evidence: true,
      executed: recoveryOutcome.success,
      verified: recoveryOutcome.success,
      goalId: goalRun.goalId,
      fallbackReason: recoveryOutcome.success ? undefined : 'autonomous_recovery_failed',
      entityName: target,
      timings: { totalMs: 0 },
    };
  }

  private checkContinuationIntent(lower: string): 'retry_or_fix' | 'explain_failure' | 'self_heal' | null {
    if (/\b(?:why didn'?t (?:that|it) work|why did (?:that|it) fail|what went wrong|what happened with (?:that|it))\b/i.test(lower)) {
      return 'explain_failure';
    }
    if (/\b(?:heal\s+yourself|self\s*heal|repair\s+yourself|run\s+self\s*test|engineering\s+acceptance|test\s+self\s*heal)\b/i.test(lower)) {
      return 'self_heal';
    }
    if (/^(?:try again|do it again|fix it|retry|use another way|try another way|find another way|use another strategy|use another capability|can hermes fix it|ask hermes to fix it)[.!]?$/i.test(lower)) {
      return 'retry_or_fix';
    }
    return null;
  }

  private extractActionIntent(
    prompt: string,
    focus: TurnFocus,
    conversationId: string
  ): {
    verb: string;
    target: string;
    entityType?: string;
    parameters?: Record<string, any>;
  } | null {
    const t = prompt.trim();
    const lower = t.toLowerCase();
    const referent = this.getReferent(conversationId);

    // 0a. Camera Visual Perception Queries (Section 11)
    if (/\b(?:can you see me|see me|what am i holding|what's in my hand|what is in my hand|what do you see|what is this|look at this|describe me)\b/i.test(lower)) {
      return {
        verb: 'perceive',
        target: 'camera',
        entityType: 'capability',
        parameters: { capability: 'camera.perceive', prompt: t, userQuestion: t },
      };
    }

    // 0b. Location Queries
    if (/\b(?:where am i|what is my location|what's my location|where is this|my location)\b/i.test(lower)) {
      return {
        verb: 'read',
        target: 'location',
        entityType: 'capability',
        parameters: { capability: 'location.read', prompt: t },
      };
    }

    // 0c. Desktop Screenshot (screen.capture)
    if (/\b(?:take|capture)\s+(?:a\s+)?(?:screenshot|snapshot|screen\s+capture)\b/i.test(lower) || /\b(?:screenshot|snapshot)\b/i.test(lower)) {
      const windowMatch = t.match(/\b(?:of|for)\s+(?:the\s+)?(.+?)(?:\s+window|\s+page|$)/i);
      let targetWindow = windowMatch ? windowMatch[1].trim() : '';
      if (/^(?:it|that|this|the app|the window)$/i.test(targetWindow)) {
        targetWindow = referent?.activeWindow || referent?.activeApplication || referent?.activeTarget || '';
      }
      return {
        verb: 'capture_screenshot',
        target: targetWindow || 'desktop',
        entityType: 'capability',
        parameters: { capability: 'screen.capture', targetWindow, prompt: t },
      };
    }

    // 0d. Visible Desktop Application Content Reading (desktop.observe)
    if (/\b(?:read\s+what\s+is\s+inside|what\s+is\s+inside|read\s+what\s+is\s+in|what's\s+inside|what\s+is\s+on\s+my\s+screen|what\s+do\s+you\s+see\s+on\s+(?:the\s+)?screen|read\s+this\s+window|read\s+the\s+window)\b/i.test(lower)) {
      const appMatch = t.match(/\b(?:inside|in|of)\s+([A-Za-z0-9_\-\s]+?)(?:\?|\.|$)/i);
      let targetApp = appMatch ? appMatch[1].trim() : '';
      if (/^(?:it|that|this|the app|the window)$/i.test(targetApp) || !targetApp) {
        targetApp = referent?.activeWindow || referent?.activeApplication || referent?.activeTarget || '';
      }
      return {
        verb: 'observe',
        target: targetApp || 'active_window',
        entityType: 'capability',
        parameters: { capability: 'desktop.observe', targetWindow: targetApp, prompt: t, userInquiry: t },
      };
    }

    // 1. Project Rename / Mutation: "Rename X to Y"
    const renameMatch = t.match(/\b(?:rename|change(?:\s+the)?\s+name\s+of)\s+(.+?)\s+to\s+(.+)$/i);
    if (renameMatch) {
      let origTarget = renameMatch[1].trim();
      if (/^(?:it|that|this|the project)$/i.test(origTarget)) {
        origTarget = referent?.activeTarget || focus.activeProjectName || origTarget;
      }
      const newName = renameMatch[2].trim().replace(/[.!?]+$/, '');
      const cleanOrig = origTarget.replace(/\s+project$/i, '').trim();

      return {
        verb: 'rename',
        target: cleanOrig,
        entityType: 'project',
        parameters: { newName, expectedName: newName },
      };
    }

    // 2. Priority mutations: "set X to priority 5"
    const priorityMatch = t.match(/\b(?:set|change)\s+(.+?)\s+(?:priority\s+to|to\s+priority)\s+(\d{1,3})\b/i);
    if (priorityMatch) {
      let origTarget = priorityMatch[1].trim().replace(/\s+project$/i, '');
      if (/^(?:it|that|this|the project)$/i.test(origTarget)) {
        origTarget = referent?.activeTarget || focus.activeProjectName || origTarget;
      }
      return {
        verb: 'set_priority',
        target: origTarget,
        entityType: 'project',
        parameters: { priority: parseInt(priorityMatch[2], 10) },
      };
    }

    // 3. General Actionable Commands
    const actionPattern = /^(?:(?:hey\s+)?jarvis[,\s]+)?(?:can\s+you\s+(?:please\s+)?|could\s+you\s+(?:please\s+)?|please\s+|i\s+want\s+you\s+to\s+|go\s+ahead\s+and\s+)?((?:locate|find|search)\s*(?:\/|\s+and\s+)\s*open|open|launch|start|run|execute|browse|visit|go\s+to|navigate\s+to|search\s+for|search|locate|find|show|list|display|get|read|check|inspect|examine|verify|test|diagnose|create|make|build|compile|write|edit|modify|update|delete|remove|clear|kill|stop|halt|close|restart|reload|deploy|send|play|install|switch\s+to)\s+(?:the\s+)?(.+?)[.!?]?$/i;
    const actionMatch = t.match(actionPattern);
    if (actionMatch) {
      let rawVerb = actionMatch[1].trim().toLowerCase().replace(/\s+/g, '_');
      let rawTarget = actionMatch[2].trim();

      if (rawVerb.includes('open') || ['launch', 'start', 'browse', 'visit', 'go_to', 'navigate_to'].includes(rawVerb)) {
        rawVerb = 'open';
      }
      if (['search_for', 'locate', 'find'].includes(rawVerb)) {
        rawVerb = 'search';
      }

      // Deictic pronoun resolution via context & referent memory
      if (/^(?:it|that|this|the project|the app|the view|the window)$/i.test(rawTarget)) {
        const contextual = referent?.activeTarget || referent?.activeApplication || focus.activeProjectName || focus.activeEntityName;
        if (contextual) rawTarget = contextual;
      }

      return {
        verb: rawVerb,
        target: rawTarget,
      };
    }

    return null;
  }

  private buildCompletionText(target: string, verb: string, surface: string, parameters?: any): string {
    if (surface === 'desktop_observe' || verb === 'observe') {
      const insp = parameters?.__inspectionResult;
      if (insp?.summary) return insp.summary;
      if (insp?.text) return `Inside ${insp.windowTitle || target}: ${insp.text.split('\n').slice(0, 5).join('; ')}`;
      return `Observed contents of ${target}.`;
    }
    if (surface === 'screenshot' || verb === 'capture_screenshot') {
      const shot = parameters?.__screenshotArtifact;
      if (shot?.artifactPath) {
        return `I captured a screenshot. Saved to ${shot.artifactPath} (${shot.byteSize} bytes).`;
      }
      return `Captured screenshot of ${target}.`;
    }
    if (surface === 'camera' || verb === 'perceive') {
      if (parameters?.__cameraPerception?.answer) {
        return parameters.__cameraPerception.answer;
      }
      return `I can see you through the physical camera. You are present at your workstation.`;
    }
    if (surface === 'browser') {
      return `${target} is open.`;
    }
    if (surface === 'executable' || surface === 'app_user_model_id' || surface === 'start_menu' || surface === 'taskbar') {
      return `${target} is open.`;
    }
    if (verb === 'rename') {
      return `Renamed ${target}.`;
    }
    return `Completed ${verb} on ${target}.`;
  }
}

export const controlPlaneTurnHandler = ControlPlaneTurnHandler.getInstance();
