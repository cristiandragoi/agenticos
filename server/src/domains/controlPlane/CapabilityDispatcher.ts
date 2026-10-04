/**
 * CapabilityDispatcher.ts — Authoritative Single Execution Authority for Compiled Plans
 *
 * PHASE 3 CONTROL-PLANE COMPONENT
 *
 * Pipeline:
 * TurnEnvelope
 *  → AuthoritativeIntentCompiler
 *  → AuthoritativeInteractionContext
 *  → CapabilityDispatcher
 *  → Capability Adapter
 *  → Verification Gateway
 *  → verified context update
 *  → response
 *
 * HARD INVARIANTS:
 * 1. ONE AUTHORITATIVE EXECUTION AUTHORITY:
 *    The ONLY entry point and orchestrator for executing compiled direct interaction plans.
 * 2. IMMUTABLE PLAN:
 *    Executes CompiledPlan step-by-step. No adapter may reinterpret user utterance or change targets.
 * 3. SEQUENTIAL EXECUTION:
 *    Step N executes → Verified by VerificationGateway → Context committed atomically → ONLY THEN Step N+1.
 * 4. STOP-ON-FIRST-FAILURE:
 *    If any step fails or cannot be verified, execution HALTS immediately.
 *    Remaining steps are NEVER executed. Never claim success after partial completion.
 * 5. ATOMIC CONTEXT COMMITS:
 *    Context is mutated only AFTER verification passes.
 * 6. ZERO LEGACY EXECUTION ESCAPE:
 *    Monitors and guarantees LEGACY_EXECUTION_ESCAPE count === 0.
 */

import { logger } from '../../utils/logger.js';
import type { TurnEnvelope } from './TurnEnvelope.js';
import type { CompiledTurnIntent, CompiledTurnPlan } from './AuthoritativeIntentCompiler.js';
import {
  authoritativeInteractionContext,
  type AuthoritativeInteractionContextData,
} from './AuthoritativeInteractionContext.js';
import {
  verificationGateway,
  type ExecutionStepResult,
} from './VerificationGateway.js';
import { universalCapabilityRuntime } from './UniversalCapabilityRuntime.js';
import {
  appCapabilityAdapter,
  chatCapabilityAdapter,
  perceptionCapabilityAdapter,
  browserCapabilityAdapter,
  delegationCapabilityAdapter,
  conversationCapabilityAdapter,
} from './adapters/index.js';
import type { ImmutableTargetIdentity } from './computerUse/AuthoritativeDesktopComputerUseProvider.js';
import { humanizeAction, toUserFacing, UNRESOLVED_UTTERANCE_REPLY } from './UserFacingResponseGuard.js';

export interface DispatcherPlanExecutionResult {
  readonly planId: string;
  readonly conversationId: string;
  readonly totalSteps: number;
  readonly executedSteps: number;
  readonly completedSuccessfully: boolean;
  readonly stepResults: readonly ExecutionStepResult[];
  readonly failedStep?: {
    stepIndex: number;
    intent: CompiledTurnIntent;
    reason: string;
  };
  readonly verifiedSteps: readonly {
    stepIndex: number;
    intent: CompiledTurnIntent;
    result: ExecutionStepResult;
  }[];
  readonly responseText: string;
  readonly legacyEscapeCount: number;
}

// ── Instrument: LEGACY_EXECUTION_ESCAPE ──────────────────────────────────
let legacyExecutionEscapeCount = 0;
const legacyEscapeLog: Array<{
  timestamp: string;
  source: string;
  reason: string;
  action?: string;
}> = [];

export function recordLegacyExecutionEscape(source: string, reason: string, action?: string): void {
  legacyExecutionEscapeCount++;
  const entry = {
    timestamp: new Date().toISOString(),
    source,
    reason,
    action,
  };
  legacyEscapeLog.push(entry);
  logger.error('[LEGACY_EXECUTION_ESCAPE] Direct compiled interaction escaped to legacy routing!', entry);
}

export function getLegacyExecutionEscapeCount(): number {
  return legacyExecutionEscapeCount;
}

export function resetLegacyExecutionEscapeCount(): void {
  legacyExecutionEscapeCount = 0;
  legacyEscapeLog.length = 0;
}

// ── Instrument: DIRECT_DISPATCH_COUNT ───────────────────────────────────
let directDispatchCount = 0;

export function getDirectDispatchCount(): number {
  return directDispatchCount;
}

export function resetDirectDispatchCount(): void {
  directDispatchCount = 0;
}

export class CapabilityDispatcher {
  private static instance: CapabilityDispatcher;

  private constructor() {}

  public static getInstance(): CapabilityDispatcher {
    if (!CapabilityDispatcher.instance) {
      CapabilityDispatcher.instance = new CapabilityDispatcher();
    }
    return CapabilityDispatcher.instance;
  }

  /**
   * Authoritative entry point for executing a compiled plan from a TurnEnvelope.
   */
  public async executePlan(
    envelope: Readonly<TurnEnvelope>,
    options: {
      onProgress?: (stepIndex: number, total: number, step: CompiledTurnIntent) => void;
      isStale?: () => boolean;
      signal?: AbortSignal;
    } = {}
  ): Promise<DispatcherPlanExecutionResult> {
    directDispatchCount++;
    const planId = `plan-${envelope.turnId}`;
    const conversationId = envelope.conversationId;
    const planSteps = (envelope.compiledPlan && envelope.compiledPlan.length > 0)
      ? envelope.compiledPlan
      : [envelope.compiledIntent];

    // Ensure compound plan tracking is active in AuthoritativeInteractionContext
    const currentCtx = authoritativeInteractionContext.getContext(conversationId);
    if ((!currentCtx.currentPlan || currentCtx.planStatus === 'IDLE') && planSteps.length > 1) {
      authoritativeInteractionContext.recordExplicitIntent(
        conversationId,
        envelope.compiledIntent,
        {
          steps: planSteps,
          rawPrompt: envelope.rawText,
          normalizedPrompt: envelope.normalizedText,
          isCompound: true,
        }
      );
    }

    logger.info('[CapabilityDispatcher] Executing compiled plan:', {
      planId,
      conversationId,
      stepCount: planSteps.length,
      steps: planSteps.map(s => `${s.action}:${s.target || s.application}`),
    });

    const stepResults: ExecutionStepResult[] = [];
    const verifiedSteps: Array<{ stepIndex: number; intent: CompiledTurnIntent; result: ExecutionStepResult }> = [];
    let failedStepInfo: { stepIndex: number; intent: CompiledTurnIntent; reason: string } | undefined;
    let turnTargetIdentity: ImmutableTargetIdentity | undefined;

    // Sequential compound execution
    for (let i = 0; i < planSteps.length; i++) {
      if (options.isStale?.() || options.signal?.aborted) {
        logger.warn('[CapabilityDispatcher] Plan execution aborted: turn is stale or superseded');
        failedStepInfo = {
          stepIndex: i,
          intent: planSteps[i],
          reason: 'Plan aborted: turn timed out or was superseded',
        };
        break;
      }

      const step = planSteps[i];
      const stepId = `${planId}-step-${i}`;

      options.onProgress?.(i, planSteps.length, step);
      logger.info(`[CapabilityDispatcher] Beginning step ${i + 1}/${planSteps.length}: ${step.action} (${step.target || step.application || 'none'})`);

      // 1. Route through UniversalCapabilityRuntime (TargetResolver -> Selector -> Execution -> Verifier)
      const executionResult = await universalCapabilityRuntime.executeStep(
        step,
        stepId,
        conversationId,
        `${envelope.turnId}-step-${i}`,
        turnTargetIdentity
      );
      stepResults.push(executionResult);

      // Preserve authoritative TargetIdentity across compound plan steps
      if (executionResult.verificationEvidence?.targetIdentity) {
        turnTargetIdentity = executionResult.verificationEvidence.targetIdentity as ImmutableTargetIdentity;
        logger.info('[CapabilityDispatcher] TargetIdentity bound and preserved for compound turn:', {
          stepIndex: i,
          hwnd: turnTargetIdentity.hwnd,
          processName: turnTargetIdentity.processName,
          title: turnTargetIdentity.title,
        });
      }

      // 2. Evaluate with Verification Gateway
      const evaluation = verificationGateway.evaluate(executionResult);

      if (!evaluation.isVerifiedSuccess) {
        // STOP-ON-FIRST-FAILURE:
        // If any step fails, STOP THE PLAN IMMEDIATELY.
        const failureReason = executionResult.failureReason || evaluation.reason;
        failedStepInfo = {
          stepIndex: i,
          intent: step,
          reason: failureReason,
        };

        logger.warn(`[CapabilityDispatcher] Step ${i + 1} failed. Halting plan execution:`, {
          stepId,
          action: step.action,
          failureReason,
        });

        // Record failure in AuthoritativeInteractionContext only if not stale
        const isConversationalStep = step.action === 'CONVERSATIONAL' || step.action === 'OTHER';
        if (!options.isStale?.() && !options.signal?.aborted) {
          if (isConversationalStep) {
            // An unresolved/conversational turn is NOT an execution failure of the previous action:
            // it must not overwrite lastExecutionFailure (causal follow-ups keep the real cause).
            logger.info('[CapabilityDispatcher] Conversational step not completed (telemetry only):', {
              stepId,
              action: step.action,
              internalReason: failureReason,
            });
          } else {
            authoritativeInteractionContext.recordStepFailure(
              conversationId,
              i,
              failureReason,
              step
            );
            // UniversalCapabilityRuntime already persisted the detailed record (technicalRootCause,
            // stage, provider, verifier details) for this exact step. Never overwrite it with a
            // generic one — that destroyed technicalRootCause in the 2026-10-04 human session.
            const runtimeTurnId = `${envelope.turnId}-step-${i}`;
            const existing = authoritativeInteractionContext.getContext(conversationId).lastExecutionFailure;
            if (!existing || existing.turnId !== runtimeTurnId) {
              authoritativeInteractionContext.recordExecutionFailure(conversationId, {
                turnId: runtimeTurnId,
                correlationId: planId,
                action: step.action,
                target: step.target || step.application || 'unknown',
                failureReason,
                technicalRootCause: failureReason,
                userFacingFailure: executionResult.outputText || failureReason,
                executionStage: `STEP_${i + 1}`,
                timestamp: Date.now(),
              });
            }
            authoritativeInteractionContext.recordFailedAction(conversationId, step, failureReason, String(envelope.turnId));
          }
        }

        // DO NOT execute remaining steps!
        break;
      }

      // Check staleness before committing to context
      if (options.isStale?.() || options.signal?.aborted) {
        logger.warn('[CapabilityDispatcher] Step completed but turn is now stale; skipping context commit.');
        break;
      }

      // 3. Step verified: Atomic commit to AuthoritativeInteractionContext
      const mutation = executionResult.contextMutation || {};
      authoritativeInteractionContext.recordVerifiedStepSuccess(
        conversationId,
        i,
        {
          ...mutation,
          summary: executionResult.outputText || mutation.summary,
        }
      );
      // Working interaction memory (modality, perception source, lastReadResult, entities)
      authoritativeInteractionContext.commitVerifiedDiscourse(conversationId, step, executionResult, String(envelope.turnId));

      verifiedSteps.push({
        stepIndex: i,
        intent: step,
        result: executionResult,
      });

      logger.info(`[CapabilityDispatcher] Step ${i + 1}/${planSteps.length} verified and committed to context.`);
    }

    const completedSuccessfully = !failedStepInfo && verifiedSteps.length === planSteps.length;
    const failedResult = failedStepInfo ? stepResults[failedStepInfo.stepIndex] : undefined;
    const rawResponseText = this.buildPlanResponse(planSteps, verifiedSteps, failedStepInfo, failedResult);
    const failedIsConversational = Boolean(failedStepInfo && (failedStepInfo.intent.action === 'CONVERSATIONAL' || failedStepInfo.intent.action === 'OTHER'));
    const responseText = completedSuccessfully
      ? rawResponseText
      : toUserFacing(
          rawResponseText,
          failedIsConversational || !failedStepInfo
            ? UNRESOLVED_UTTERANCE_REPLY
            : `I couldn't ${humanizeAction(failedStepInfo.intent.action)}.`,
          { planId, conversationId }
        );

    const planResult: DispatcherPlanExecutionResult = {
      planId,
      conversationId,
      totalSteps: planSteps.length,
      executedSteps: stepResults.length,
      completedSuccessfully,
      stepResults,
      failedStep: failedStepInfo,
      verifiedSteps,
      responseText,
      legacyEscapeCount: legacyExecutionEscapeCount,
    };

    logger.info('[CapabilityDispatcher] Plan execution finished:', {
      planId,
      completedSuccessfully,
      verifiedCount: verifiedSteps.length,
      failed: Boolean(failedStepInfo),
    });

    return planResult;
  }

  /**
   * Dispatches an individual compiled intent to its authoritative capability adapter.
   */
  private async dispatchToAdapter(
    step: CompiledTurnIntent,
    stepId: string | number,
    conversationId: string
  ): Promise<ExecutionStepResult> {
    switch (step.action) {
      case 'OPEN_APPLICATION':
      case 'FOCUS_APPLICATION' as any:
      case 'CLOSE_APPLICATION' as any:
        return appCapabilityAdapter.execute(step, stepId, conversationId);

      case 'OPEN_CHAT':
      case 'READ_MESSAGES':
        return chatCapabilityAdapter.execute(step, stepId, conversationId);

      case 'READ_CONTENT':
      case 'READ_SCREEN' as any:
      case 'READ_WINDOW' as any:
      case 'CAMERA_OBSERVE' as any:
        return perceptionCapabilityAdapter.execute(step, stepId, conversationId);

      case 'NAVIGATE_WEB':
      case 'OPEN_URL':
      case 'READ_WEB_CONTENT' as any:
        return browserCapabilityAdapter.execute(step, stepId, conversationId);

      case 'DELEGATE':
      case 'AUTONOMOUS_TASK' as any:
        return delegationCapabilityAdapter.execute(step, stepId, conversationId);

      case 'CONVERSATIONAL':
      case 'OTHER':
        return conversationCapabilityAdapter.execute(step, stepId, conversationId);

      default:
        // Unhandled action
        return {
          stepId,
          action: step.action,
          requestedTarget: step.target,
          success: false,
          verified: false,
          failureReason: `No authoritative adapter available for action '${step.action}'.`,
        };
    }
  }

  /**
   * Formulates clear, accurate user response text based on verified outcome.
   * Handles compound plans, partial stop-on-failure, and specific required formats.
   */
  private buildPlanResponse(
    planSteps: readonly CompiledTurnIntent[],
    verifiedSteps: readonly { stepIndex: number; intent: CompiledTurnIntent; result: ExecutionStepResult }[],
    failedStep?: { stepIndex: number; intent: CompiledTurnIntent; reason: string },
    failedResult?: ExecutionStepResult
  ): string {
    // 1. All steps completed successfully
    if (!failedStep && verifiedSteps.length === planSteps.length) {
      if (planSteps.length === 1) {
        return verifiedSteps[0].result.outputText || `Successfully completed ${planSteps[0].action}.`;
      }

      // Compound plan success
      const step1 = verifiedSteps[0];
      const step2 = verifiedSteps[1];

      // E.g. Telegram + Chat
      if (step1.intent.action === 'OPEN_APPLICATION' && step2.intent.action === 'OPEN_CHAT') {
        const app = step1.result.executedTarget || step1.intent.application || 'Telegram';
        const chat = step2.intent.target || 'Agentic OS bot';
        if (verifiedSteps.length >= 3 && verifiedSteps[2].intent.action === 'READ_MESSAGES') {
          return `${verifiedSteps[2].result.outputText}`;
        }
        return `I have opened ${app} and selected the ${chat} conversation.`;
      }

      // E.g. Chrome + YouTube
      if (step1.intent.action === 'OPEN_APPLICATION' && (step2.intent.action === 'NAVIGATE_WEB' || step2.intent.action === 'OPEN_URL')) {
        const app = step1.result.executedTarget || step1.intent.application || 'Chrome';
        const url = step2.intent.target || step2.result.executedTarget || 'YouTube';
        return `I have opened ${app} and navigated to ${url}.`;
      }

      // Generic compound success
      return verifiedSteps.map(s => s.result.outputText).filter(Boolean).join(' ');
    }

    // 2. Failure case
    if (failedStep) {
      const failedIdx = failedStep.stepIndex;
      const failedIntent = failedStep.intent;

      // Conversational/unresolved steps: the adapter's user-facing text is authoritative;
      // the internal failureReason is telemetry only.
      if (failedIntent.action === 'CONVERSATIONAL' || failedIntent.action === 'OTHER') {
        return failedResult?.outputText || UNRESOLVED_UTTERANCE_REPLY;
      }

      // Compound plan partial failure
      if (failedIdx > 0 && verifiedSteps.length > 0) {
        const prevStep = verifiedSteps[0];

        // Specific Required Contracts:
        if (failedStep.reason && failedStep.reason.includes('could not locate and verify')) {
          return failedStep.reason;
        }

        if (
          failedStep.reason &&
          (failedStep.reason.includes('could not verify the') || failedStep.reason.includes('wrong chat') || failedStep.reason.includes('conversation'))
        ) {
          const app = prevStep.result.executedTarget || prevStep.intent.application || 'Telegram';
          const chat = failedIntent.target || 'Agentic OS bot';
          return `${app} is open, but I could not locate and verify the ${chat} conversation.`;
        }

        if (prevStep.intent.action === 'OPEN_APPLICATION' && (failedIntent.action === 'READ_MESSAGES' || failedIntent.action === 'READ_CONTENT')) {
          const app = prevStep.result.executedTarget || prevStep.intent.application || 'Telegram';
          return `I found ${app}, but I couldn't reliably read the requested messages.`;
        }

        if (prevStep.intent.action === 'OPEN_APPLICATION' && failedIntent.action === 'OPEN_CHAT') {
          const app = prevStep.result.executedTarget || prevStep.intent.application || 'Telegram';
          const chat = failedIntent.target || 'Agentic OS bot';
          return `${app} is open, but I could not locate and verify the ${chat} conversation.`;
        }

        // Generic partial failure
        const prevDesc = prevStep.result.executedTarget || prevStep.intent.application || 'The first step';
        return `${prevDesc} completed, but I couldn't ${humanizeAction(failedIntent.action)}: ${failedStep.reason}`;
      }

      // Single step failure or step 0 failure
      const reasonLower = (failedStep.reason || '').toLowerCase();
      if (reasonLower.includes('timed out') || reasonLower.includes('timeout')) {
        return 'That request timed out while waiting for the application.';
      }
      if (
        reasonLower.includes('not locate') ||
        reasonLower.includes('could not find') ||
        reasonLower.includes('no running process') ||
        reasonLower.includes('could not resolve') ||
        reasonLower.includes('not resolve') ||
        failedIntent.action === 'OPEN_APPLICATION'
      ) {
        return "I couldn't locate the requested application window.";
      }
      if (reasonLower.includes('verify') || reasonLower.includes('verification')) {
        return "I performed the action, but I couldn't verify the result.";
      }

      return failedStep.reason || 'Plan execution could not be completed.';
    }

    return 'Plan execution could not be completed.';
  }
}

export const capabilityDispatcher = CapabilityDispatcher.getInstance();
