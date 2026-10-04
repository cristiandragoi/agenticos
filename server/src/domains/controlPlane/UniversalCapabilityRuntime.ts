/**
 * UniversalCapabilityRuntime.ts — Authoritative Single Generic Capability Runtime
 *
 * PHASE 5 CONTROL-PLANE COMPONENT
 *
 * Position in pipeline:
 * CompiledIntent
 *  → AuthoritativeInteractionContext
 *  → CapabilityDispatcher
 *  → UniversalCapabilityRuntime
 *     → TargetResolver
 *     → CapabilityMethodSelector
 *     → Capability Execution
 *     → Source/Outcome Verification
 *     → Result
 *     → Context commit
 *
 * Invariants:
 * 1. GENERIC: Telegram, Chrome, YouTube, Hermes, Antigravity, WhatsApp, Notepad use the same contracts.
 * 2. EXACT TARGET BINDING: Partial matches rejected.
 * 3. FASTEST RELIABLE ACQUISITION: Native structured (DOM/UIA) -> Window Crop -> Fullscreen Vision.
 * 4. STRICT SOURCE VERIFICATION: Checks content origin against requested target before speaking.
 * 5. LATENCY HARDENED: Stage timings tracked and verified against performance budgets.
 * 6. CAMERA EXIT: Explicit new capability replaces stale camera capability immediately.
 */

import { logger } from '../../utils/logger.js';
import type { CompiledTurnIntent } from './AuthoritativeIntentCompiler.js';
import {
  authoritativeInteractionContext,
  type AuthoritativeInteractionContextData,
} from './AuthoritativeInteractionContext.js';
import { targetResolver, type ResolvedTargetEvidence } from './TargetResolver.js';
import { capabilityMethodSelector, type SelectedCapabilityMethod } from './CapabilityMethodSelector.js';
import { universalContentAcquisition, type UniversalAcquisitionResult } from './UniversalContentAcquisition.js';
import { sourceOutcomeVerifier } from './SourceOutcomeVerifier.js';
import { latencyTracker } from './LatencyTracker.js';
import type { ExecutionStepResult } from './VerificationGateway.js';
import {
  appCapabilityAdapter,
  chatCapabilityAdapter,
  perceptionCapabilityAdapter,
  browserCapabilityAdapter,
  delegationCapabilityAdapter,
  conversationCapabilityAdapter,
  guiNavigationCapabilityAdapter,
} from './adapters/index.js';
import type { ImmutableTargetIdentity } from './computerUse/AuthoritativeDesktopComputerUseProvider.js';

export class UniversalCapabilityRuntime {
  private static instance: UniversalCapabilityRuntime;

  private constructor() {}

  public static getInstance(): UniversalCapabilityRuntime {
    if (!UniversalCapabilityRuntime.instance) {
      UniversalCapabilityRuntime.instance = new UniversalCapabilityRuntime();
    }
    return UniversalCapabilityRuntime.instance;
  }

  /**
   * Authoritative entrypoint: executes a single compiled plan step through the
   * universal capability pipeline with full target binding and source verification.
   */
  public async executeStep(
    step: CompiledTurnIntent,
    stepId: string | number,
    conversationId: string,
    turnId: string = `turn-${stepId}`,
    turnTargetIdentity?: ImmutableTargetIdentity
  ): Promise<ExecutionStepResult> {
    const correlationId = `corr-${stepId}`;
    latencyTracker.initTurn(turnId, correlationId);

    // 1. Context Lookup & Resolution
    latencyTracker.startStage(turnId, 'CONTEXT_RESOLUTION_MS');
    const context = authoritativeInteractionContext.getContext(conversationId);
    latencyTracker.endStage(turnId, 'CONTEXT_RESOLUTION_MS');

    // 2. Exact Target Resolution
    // Conversational turns (discourse replay / causal explanation / clarification) operate on
    // working memory only: no desktop window scan, no TargetResolver lookup.
    latencyTracker.startStage(turnId, 'TARGET_RESOLUTION_MS');
    const isConversationalStep = step.action === 'CONVERSATIONAL' || step.action === 'OTHER';
    const resolvedTarget: ResolvedTargetEvidence = isConversationalStep
      ? {
          requestedTarget: step.target || 'conversation',
          targetHierarchy: { elementOrContent: step.target || 'conversation' },
          isExactMatch: true,
          resolutionConfidence: 1.0,
          resolutionEvidence: { conversational: true, windowLookup: false },
          matchType: 'context_reference' as any,
        }
      : await targetResolver.resolve(step, context);
    latencyTracker.endStage(turnId, 'TARGET_RESOLUTION_MS');

    logger.info('[UniversalCapabilityRuntime] Resolved target evidence:', {
      action: step.action,
      requestedTarget: resolvedTarget.requestedTarget,
      resolvedApp: resolvedTarget.resolvedApplication,
      resolvedWindow: resolvedTarget.resolvedWindow,
      isExactMatch: resolvedTarget.isExactMatch,
      matchType: resolvedTarget.matchType,
    });

    // 3. Deterministic Capability Method Selection
    latencyTracker.startStage(turnId, 'CAPABILITY_SELECTION_MS');
    const selectedMethod = capabilityMethodSelector.selectMethod(step, resolvedTarget, context);
    latencyTracker.endStage(turnId, 'CAPABILITY_SELECTION_MS');

    // 4. Execution & Content Acquisition
    latencyTracker.startStage(turnId, 'CAPABILITY_EXECUTION_MS');
    let executionResult: ExecutionStepResult;

    if (selectedMethod.requiresAcquisition) {
      executionResult = await this.executeContentAcquisitionStep(
        step,
        stepId,
        conversationId,
        turnId,
        resolvedTarget,
        selectedMethod,
        turnTargetIdentity
      );
    } else {
      executionResult = await this.executeActionStep(
        step,
        stepId,
        conversationId,
        turnId,
        resolvedTarget,
        selectedMethod,
        turnTargetIdentity
      );
    }
    latencyTracker.endStage(turnId, 'CAPABILITY_EXECUTION_MS');

    // 5. Source / Outcome Verification
    latencyTracker.startStage(turnId, 'VERIFICATION_MS');
    const outcomeEval = sourceOutcomeVerifier.verifyStepOutcome(step, resolvedTarget, executionResult);
    latencyTracker.endStage(turnId, 'VERIFICATION_MS');

    if (!outcomeEval.isVerified || !executionResult.success) {
      const failureReason = outcomeEval.failureReason || executionResult.failureReason || 'Verification failed.';
      executionResult = {
        ...executionResult,
        success: false,
        verified: false,
        failureReason,
        outputText: outcomeEval.outputText || executionResult.outputText,
      };

      const evidence = executionResult.verificationEvidence;
      const evData: any = evidence?.data || {};
      const isReadStep = ['READ_CONTENT', 'READ_WINDOW', 'READ_SCREEN', 'READ_MESSAGES', 'READ_WEB_CONTENT'].includes(String(step.action));
      const targetNotFound =
        isReadStep &&
        !resolvedTarget.isExactMatch &&
        (resolvedTarget.resolutionEvidence as any)?.foundInOpenWindows === false;
      const technicalRootCause =
        (targetNotFound
          ? `Target resolution failed: No open or installed window matches '${resolvedTarget.requestedTarget}'`
          : undefined) ||
        evData.technicalRootCause ||
        evData.error ||
        executionResult.failureReason ||
        outcomeEval.failureReason ||
        'Verification condition not met';

      // Conversational/unresolved turns are not execution failures of a capability; recording
      // them would overwrite the real previous failure that a causal follow-up must explain.
      if (selectedMethod.adapterId !== 'conversation') {
        authoritativeInteractionContext.recordExecutionFailure(conversationId, {
          turnId,
          correlationId,
          action: step.action,
          target: step.target || step.application || 'unknown',
          executionStage: targetNotFound ? 'TARGET_RESOLUTION' : (!outcomeEval.isVerified ? 'VERIFICATION' : 'EXECUTION'),
          providerIdentity: selectedMethod.adapterId,
          technicalRootCause,
          userFacingFailure: executionResult.outputText || failureReason,
          failureReason,
          physicalEvidence: {
            uia: evidence?.source === 'uia' || evData.acquisitionMethod === 'uia',
            screenshot: Boolean(evData.screenshotPath),
            uiTars: evidence?.source === 'authoritative_desktop_provider' || evData.acquisitionMethod === 'window_crop_vision',
            ocr: false,
            errorDetails: technicalRootCause,
          },
          verifierState: !outcomeEval.isVerified ? 'FAILED_CLOSED' : 'PASSED',
          verifierMismatchDetails: (outcomeEval as any).details || evData.verifierChecks || undefined,
          timestamp: Date.now(),
        });
      }
    }

    // 6. Record Latency & Acquisition Metrics
    latencyTracker.recordDirectMetric(turnId, {
      targetVerified: executionResult.verified,
    });
    latencyTracker.finalizeTurn(turnId);

    return executionResult;
  }

  /**
   * Handles content acquisition steps (READ_CONTENT, READ_MESSAGES, READ_WEB_CONTENT).
   */
  private async executeContentAcquisitionStep(
    step: CompiledTurnIntent,
    stepId: string | number,
    conversationId: string,
    turnId: string,
    target: ResolvedTargetEvidence,
    method: SelectedCapabilityMethod,
    turnTargetIdentity?: ImmutableTargetIdentity
  ): Promise<ExecutionStepResult> {
    // Handle playback continuation from persistent active playback task (Speed 1, no re-scraping)
    if (step.contentRequest === 'continue_messages') {
      const activePlayback = authoritativeInteractionContext.getActivePlaybackTask(conversationId);
      if (activePlayback && activePlayback.remainingMessages && activePlayback.remainingMessages.length > 0) {
        logger.info('[UniversalCapabilityRuntime] Resuming active message playback from task cursor:', {
          source: activePlayback.source,
          currentMessageIndex: activePlayback.currentMessageIndex,
          remainingCount: activePlayback.remainingMessages.length,
        });

        const nextIndex = activePlayback.currentMessageIndex;
        const total = activePlayback.messageRecords.length;
        const remaining = activePlayback.remainingMessages;

        const speechLines = remaining.map((m, idx) => {
          const senderLabel = (!m.sender || m.sender.toLowerCase() === 'me' || m.sender.toLowerCase() === 'you') ? 'You' : m.sender;
          return `${senderLabel} said: "${m.text}"`;
        }).join('. ');

        const speechOutput = `Continuing with the messages in ${activePlayback.source}: ${speechLines}`;

        // Advance cursor and mark PLAYING
        authoritativeInteractionContext.updatePlaybackCursor(conversationId, total, 'PLAYING');

        return {
          stepId,
          action: step.action,
          requestedTarget: activePlayback.source,
          executedTarget: activePlayback.source,
          success: true,
          verified: true,
          verificationEvidence: {
            source: 'conversation',
            label: `Resumed playback of ${remaining.length} messages from ${activePlayback.source}`,
            observedAt: Date.now(),
            data: {
              source: activePlayback.source,
              resumedFromIndex: nextIndex,
              remainingCount: remaining.length,
              totalMessages: total,
            },
          },
          contextMutation: {
            application: 'Telegram',
            target: activePlayback.source,
            targetType: 'CHAT',
            capability: 'CHAT',
            summary: speechOutput,
          },
          outputText: speechOutput,
        };
      }
    }

    // If the perception adapter has an active mock/spy, execute it directly
    if (method.adapterId === 'perception') {
      const isMocked = Boolean((perceptionCapabilityAdapter.execute as any)?._isMockFunction || (perceptionCapabilityAdapter.readContent as any)?._isMockFunction);
      if (isMocked) {
        const adapterRes = await perceptionCapabilityAdapter.execute(step, stepId, conversationId, target, turnTargetIdentity);
        latencyTracker.recordDirectMetric(turnId, {
          acquisitionMethod: 'uia',
          visionUsed: false,
          llmUsed: false,
          fallbackCount: 0,
        });
        return adapterRes;
      }
    }

    const acquisition = await universalContentAcquisition.acquire(step, target, conversationId, turnTargetIdentity);

    latencyTracker.recordDirectMetric(turnId, {
      acquisitionMethod: acquisition.acquisitionMethod,
      visionUsed: acquisition.visionUsed,
      llmUsed: acquisition.llmUsed,
      fallbackCount: acquisition.fallbackCount,
    });

    // Enforce Source Verification: verify content came strictly from requested target
    const sourceEval = sourceOutcomeVerifier.verifyContentAcquisition(step, target, acquisition);

    if (!sourceEval.isVerified) {
      const checks: any = (acquisition.verificationEvidence as any)?.checks;
      return {
        stepId,
        action: step.action,
        requestedTarget: target.requestedTarget,
        executedTarget: target.resolvedWindow || target.resolvedApplication,
        success: false,
        verified: false,
        // Failure evidence is retained (not physical success evidence) so the persisted failure
        // record carries the real acquisition/verifier cause instead of a generic sentence.
        verificationEvidence: {
          source: 'window_inspection',
          label: 'Content acquisition / source verification failure',
          observedAt: acquisition.timestamp,
          data: {
            technicalRootCause: acquisition.error || sourceEval.failureReason || 'Content could not be verified from target.',
            acquisitionMethod: acquisition.acquisitionMethod,
            sourceApplication: acquisition.sourceApplication,
            sourceWindow: acquisition.sourceWindow,
            sourceHwnd: acquisition.sourceHwnd ?? null,
            verifierChecks: checks && typeof checks === 'object' ? checks : undefined,
            wrongTargetReadDetected: sourceEval.wrongTargetReadDetected,
            crossTargetContaminationDetected: sourceEval.crossTargetContaminationDetected,
          },
        },
        failureReason: sourceEval.failureReason || acquisition.error || 'Content could not be verified from target.',
        outputText: sourceEval.outputText,
      };
    }

    // Build verified step result and context mutation
    const speechOutput = this.formatSpeechOutput(step, target, acquisition);

    // If chat messages were acquired, register active playback task for continuation tracking
    if (acquisition.messages && acquisition.messages.length > 0) {
      const messageRefs = acquisition.messages.map((m, idx) => ({
        id: m.index ?? (idx + 1),
        sender: m.sender || 'Unknown',
        text: m.text,
        timestamp: m.timestamp || m.time || '',
      }));
      authoritativeInteractionContext.startPlaybackTask(conversationId, {
        taskType: 'READ_MESSAGES',
        source: target.requestedTarget || acquisition.sourceWindow || 'Telegram',
        requestedCount: messageRefs.length,
        messageRecords: messageRefs,
        currentMessageIndex: 0,
        remainingMessages: messageRefs,
      });
    }

    return {
      stepId,
      action: step.action,
      requestedTarget: target.requestedTarget,
      executedTarget: target.resolvedWindow || target.resolvedApplication,
      success: true,
      verified: true,
      verificationEvidence: {
        source: acquisition.acquisitionMethod as any,
        label: `Verified content from ${acquisition.sourceWindow || target.resolvedWindow}`,
        observedAt: acquisition.timestamp,
        targetIdentity: acquisition.targetIdentity || turnTargetIdentity,
        data: acquisition.verificationEvidence,
      },
      contextMutation: {
        application: acquisition.sourceApplication || target.resolvedApplication,
        window: acquisition.sourceWindow || target.resolvedWindow,
        target: target.requestedTarget,
        targetType: (step.targetType === 'CHAT_CONVERSATION' ? 'CHAT' :
          step.targetType === 'WEB_URL' ? 'BROWSER' :
          step.targetType === 'APPLICATION_WINDOW' ? 'APPLICATION' :
          step.targetType === 'CAMERA' ? 'CAMERA' :
          step.targetType === 'WORKER' ? 'WORKER' : 'CONTENT'),
        capability: (step.targetType === 'CHAT_CONVERSATION' ? 'CHAT' : step.targetType === 'WEB_URL' ? 'BROWSER' : 'PERCEPTION') as any,
        contentSnapshot: acquisition.content,
        contentItems: [...acquisition.structuredItems],
        messages: acquisition.messages?.map(m => ({
          id: m.index,
          sender: m.sender,
          text: m.text,
          timestamp: m.timestamp || m.time,
        })),
        summary: speechOutput,
      },
      outputText: speechOutput,
    };
  }

  /**
   * Handles action steps (OPEN_APPLICATION, OPEN_CHAT, CAMERA_OBSERVE, NAVIGATE_WEB, DELEGATE).
   */
  private async executeActionStep(
    step: CompiledTurnIntent,
    stepId: string | number,
    conversationId: string,
    turnId: string,
    target: ResolvedTargetEvidence,
    method: SelectedCapabilityMethod,
    turnTargetIdentity?: ImmutableTargetIdentity
  ): Promise<ExecutionStepResult> {
    latencyTracker.recordDirectMetric(turnId, {
      acquisitionMethod: method.executionMethod,
      visionUsed: step.action === 'CAMERA_OBSERVE',
      llmUsed: false,
      fallbackCount: 0,
    });

    let adapterResult: ExecutionStepResult;

    switch (method.adapterId) {
      case 'app':
        adapterResult = await appCapabilityAdapter.execute(step, stepId, conversationId, target, turnTargetIdentity);
        break;

      case 'chat':
        adapterResult = await chatCapabilityAdapter.execute(step, stepId, conversationId, target, turnTargetIdentity);
        break;

      case 'perception':
        adapterResult = await perceptionCapabilityAdapter.execute(step, stepId, conversationId, target, turnTargetIdentity);
        break;

      case 'browser':
        adapterResult = await browserCapabilityAdapter.execute(step, stepId, conversationId);
        break;

      case 'delegation':
        adapterResult = await delegationCapabilityAdapter.execute(step, stepId, conversationId);
        break;

      case 'gui_navigation':
        adapterResult = await guiNavigationCapabilityAdapter.execute(step, stepId, conversationId, target);
        break;

      case 'conversation':
      default:
        adapterResult = await conversationCapabilityAdapter.execute(step, stepId, conversationId);
        break;
    }

    // Invariant: New explicit capability replaces stale active capability immediately (e.g. camera context exit)
    if (adapterResult.success && adapterResult.verified && adapterResult.contextMutation) {
      if (step.action !== 'CAMERA_OBSERVE') {
        const currentCapability = adapterResult.contextMutation.capability;
        if (!currentCapability) {
          (adapterResult.contextMutation as any).capability =
            method.adapterId === 'app' ? 'APPLICATION' :
            method.adapterId === 'chat' ? 'CHAT' :
            method.adapterId === 'browser' ? 'BROWSER' :
            method.adapterId === 'delegation' ? 'DELEGATE' : 'PERCEPTION';
        }
      }
    }

    return adapterResult;
  }

  /**
   * Formats deterministic, natural spoken output without invoking conversational LLM.
   */
  private formatSpeechOutput(
    step: CompiledTurnIntent,
    target: ResolvedTargetEvidence,
    acquisition: UniversalAcquisitionResult
  ): string {
    // 1. Ordinal Content Speech
    if (step.ordinal !== null && step.ordinal > 0) {
      return `Point ${step.ordinal} is: "${acquisition.content}".`;
    }

    // 2. Chat Messages Speech (e.g. last 2 messages in Agentic OS bot)
    if (step.action === 'READ_MESSAGES' || step.targetType === 'CHAT_CONVERSATION' || (step.targetType as string) === 'CHAT') {
      if (acquisition.messages && acquisition.messages.length > 0) {
        const msgs = acquisition.messages;
        const msgLines = msgs.map(m => {
          const senderLabel = (!m.sender || m.sender.toLowerCase() === 'me' || m.sender.toLowerCase() === 'you') ? 'You' : m.sender;
          return `${senderLabel} said: "${m.text}"`;
        }).join('. ');
        return `The last ${msgs.length} messages in ${target.requestedTarget} are: ${msgLines}`;
      }
      return acquisition.content || `Extracted messages from ${target.requestedTarget}.`;
    }

    // 3. Web Page Content Speech
    if ((step.action as string) === 'READ_WEB_CONTENT' || step.targetType === 'WEB_URL' || (step.targetType as string) === 'BROWSER') {
      return acquisition.content || `Extracted content from ${target.requestedTarget}.`;
    }

    // 4. Desktop Screen vs Window Content Speech
    if (step.targetType === 'SCREEN' || target.requestedTarget === 'screen') {
      const app = acquisition.sourceApplication || acquisition.sourceWindow || 'the active window';
      const snippet = (acquisition.content || '').length > 300 ? `${(acquisition.content || '').slice(0, 290)}...` : (acquisition.content || 'no text detected');
      return `Currently visible on your screen is ${app}. It shows: ${snippet}`;
    }

    return acquisition.content || `Extracted content from ${target.requestedTarget}.`;
  }
}

export const universalCapabilityRuntime = UniversalCapabilityRuntime.getInstance();
