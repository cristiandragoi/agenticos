/**
 * ControlPlaneTurnHandler.ts — Universal Production Execution & Recovery Controller
 *
 * Implements the single authoritative end-to-end execution lifecycle:
 * USER → VOICE/TEXT INPUT → UNDERSTAND GOAL → ACKNOWLEDGE → CREATE DURABLE GOALRUN
 * → PLAN → DISCOVER CAPABILITIES → EXECUTE → OBSERVE REAL-WORLD STATE → VERIFY
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
import { projectsStore } from '../../services/projectsStore.js';
import type { TurnResult, TurnFocus } from '../jarvisNext/turnRouter.js';
import type { GoalRun, GoalAttempt, DiscoveredCapability } from './types.js';

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

export class ControlPlaneTurnHandler {
  private static instance: ControlPlaneTurnHandler;

  private constructor() {}

  public static getInstance(): ControlPlaneTurnHandler {
    if (!ControlPlaneTurnHandler.instance) {
      ControlPlaneTurnHandler.instance = new ControlPlaneTurnHandler();
    }
    return ControlPlaneTurnHandler.instance;
  }

  /**
   * Determine if the user prompt is an actionable goal or continuation.
   * If so, execute the full autonomous control plane lifecycle.
   * Returns TurnResult if handled, or null if the prompt is purely conversational.
   */
  public async handleTurn(opts: ControlPlaneTurnOpts): Promise<TurnResult | null> {
    const { prompt, effectivePrompt, conversationId, turnId, onActionProgress, focus } = opts;
    const lower = effectivePrompt.toLowerCase().trim();

    // ── 1. Conversation Continuity: Continuation / Recovery commands ───────
    // User phrases like "Try again", "Fix it", "Use another way", "Why didn't it work?"
    const isContinuation = this.checkContinuationIntent(lower);
    if (isContinuation) {
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

    // ── 2. Action Intent & Target Extraction ────────────────────────────────
    const goalIntent = this.extractActionIntent(effectivePrompt, focus);
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

    // ── 4. Planning & Capability Discovery Across 11 Surfaces ──────────────
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
        // Default to shell / browser search
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

    // ── 6. Independent Reality Verification ────────────────────────────────
    goalLifecycleManager.transitionState(goalRun.goalId, 'VERIFYING', {
      actor: 'UniversalVerifier',
      summary: `Verifying real-world outcome on surface "${primaryStrategy.surface}".`,
    });

    onActionProgress?.({
      actionName: `Verify ${target}`,
      targetCapability: primaryStrategy.surface,
      status: 'running',
      stage: 'VERIFYING',
      currentStep: `Verifying real outcome on ${primaryStrategy.surface}...`,
      goalId: goalRun.goalId,
    });

    let verification = await universalVerifier.verify({
      surface: primaryStrategy.surface,
      target: primaryStrategy.target,
      parameters: primaryStrategy.parameters,
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

    // ── 7. Success Verification Gate ───────────────────────────────────────
    if (execResult.executed && verification.verified) {
      const completionText = this.buildCompletionText(target, verb, primaryStrategy.surface);
      goalLifecycleManager.recordVerification(goalRun.goalId, verification);
      goalLifecycleManager.transitionState(goalRun.goalId, 'COMPLETED', {
        actor: 'UniversalVerifier',
        summary: completionText,
        detail: verification,
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

    return {
      handled: true,
      route: 'action',
      text: recoveryOutcome.finalResponseText,
      evidence: true,
      executed: recoveryOutcome.success,
      verified: recoveryOutcome.success,
      goalId: goalRun.goalId,
      fallbackReason: recoveryOutcome.success ? undefined : 'autonomous_recovery_failed',
      entityName: target,
      timings: { totalMs: 0 },
    };
  }

  private checkContinuationIntent(lower: string): 'retry_or_fix' | 'explain_failure' | null {
    if (/\b(?:why didn'?t (?:that|it) work|why did (?:that|it) fail|what went wrong|what happened with (?:that|it))\b/i.test(lower)) {
      return 'explain_failure';
    }
    if (/^(?:try again|do it again|fix it|retry|use another way|try another way|find another way|use another strategy|use another capability|can hermes fix it|ask hermes to fix it)[.!]?$/i.test(lower)) {
      return 'retry_or_fix';
    }
    return null;
  }

  private extractActionIntent(
    prompt: string,
    focus: TurnFocus
  ): {
    verb: string;
    target: string;
    entityType?: string;
    parameters?: Record<string, any>;
  } | null {
    const t = prompt.trim();
    const lower = t.toLowerCase();

    // 0a. Camera Visual Perception Queries (Section 13)
    if (/\b(?:can you see me|see me|what am i holding|what's in my hand|what is in my hand|what do you see|what is this|look at this)\b/i.test(lower)) {
      return {
        verb: 'perceive',
        target: 'camera',
        entityType: 'capability',
        parameters: { capability: 'camera.perceive', prompt: t, userQuestion: t },
      };
    }

    // 0b. Location Queries (Section 14)
    if (/\b(?:where am i|what is my location|what's my location|where is this|my location)\b/i.test(lower)) {
      return {
        verb: 'read',
        target: 'location',
        entityType: 'capability',
        parameters: { capability: 'location.read', prompt: t },
      };
    }

    // 1. Project Rename / Mutation: "Rename X to Y"
    const renameMatch = t.match(/\b(?:rename|change(?:\s+the)?\s+name\s+of)\s+(.+?)\s+to\s+(.+)$/i);
    if (renameMatch) {
      const origTarget = renameMatch[1].trim();
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
      return {
        verb: 'set_priority',
        target: priorityMatch[1].trim().replace(/\s+project$/i, ''),
        entityType: 'project',
        parameters: { priority: parseInt(priorityMatch[2], 10) },
      };
    }

    // 3. General Actionable Commands
    const actionPattern = /^(?:(?:hey\s+)?jarvis[,\s]+)?(?:can\s+you\s+(?:please\s+)?|could\s+you\s+(?:please\s+)?|please\s+|i\s+want\s+you\s+to\s+|go\s+ahead\s+and\s+)?(open|launch|start|run|execute|browse|visit|go\s+to|navigate\s+to|search\s+for|search|locate|find|show|list|display|get|read|check|inspect|examine|verify|test|diagnose|create|make|build|compile|write|edit|modify|update|delete|remove|clear|kill|stop|halt|close|restart|reload|deploy|send|play|install|switch\s+to)\s+(?:the\s+)?(.+?)[.!?]?$/i;
    const actionMatch = t.match(actionPattern);
    if (actionMatch) {
      let rawVerb = actionMatch[1].trim().toLowerCase().replace(/\s+/g, '_');
      let rawTarget = actionMatch[2].trim();

      if (['launch', 'start', 'browse', 'visit', 'go_to', 'navigate_to'].includes(rawVerb)) {
        rawVerb = 'open';
      }
      if (['search_for', 'locate', 'find'].includes(rawVerb)) {
        rawVerb = 'search';
      }

      // Deictic pronoun resolution
      if (/^(?:it|that|this|the project|the app|the view)$/i.test(rawTarget)) {
        const contextual = focus.activeProjectName || focus.activeEntityName;
        if (contextual) rawTarget = contextual;
      }

      return {
        verb: rawVerb,
        target: rawTarget,
      };
    }

    return null;
  }

  private buildCompletionText(target: string, verb: string, surface: string): string {
    if (surface === 'browser') {
      return `${target} is open.`;
    }
    if (surface === 'executable' || surface === 'app_user_model_id' || surface === 'start_menu') {
      return `${target} is open.`;
    }
    if (verb === 'rename') {
      return `Renamed ${target}.`;
    }
    return `Completed ${verb} on ${target}.`;
  }
}

export const controlPlaneTurnHandler = ControlPlaneTurnHandler.getInstance();
