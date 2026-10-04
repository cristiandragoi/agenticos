/**
 * SourceOutcomeVerifier.ts — Authoritative Source & Outcome Verification Engine
 *
 * PHASE 5 CONTROL-PLANE COMPONENT
 *
 * Enforces strict pre-response verification:
 * 1. Checks that acquired content was sourced strictly from the requested target.
 * 2. Cross-Target Contamination Prevention:
 *    - User asked for "Hermes 1" but source was "Antigravity" -> FAIL!
 * 3. Wrong-Chat Prevention:
 *    - User asked for "Telegram / Agentic OS bot" but active chat was "Russell, Linda and friends" -> FAIL!
 *    - Jarvis speaks: "Telegram is open, but I could not verify the Agentic OS bot conversation."
 * 4. Tracks invariants:
 *    - CROSS_TARGET_CONTAMINATION_COUNT === 0
 *    - WRONG_TARGET_READS_COUNT === 0
 *    - UNVERIFIED_SUCCESS_COUNT === 0
 */

import { logger } from '../../utils/logger.js';
import type { CompiledTurnIntent } from './AuthoritativeIntentCompiler.js';
import type { ResolvedTargetEvidence } from './TargetResolver.js';
import type { UniversalAcquisitionResult } from './UniversalContentAcquisition.js';
import type { ExecutionStepResult } from './VerificationGateway.js';

export interface SourceVerificationEvaluation {
  readonly isVerified: boolean;
  readonly failureReason?: string;
  readonly outputText?: string;
  readonly crossTargetContaminationDetected: boolean;
  readonly wrongTargetReadDetected: boolean;
  readonly unverifiedSuccessDetected: boolean;
}

// ── Invariant Instruments ──────────────────────────────────────────────────
let crossTargetContaminationCount = 0;
let wrongTargetReadsCount = 0;
let unverifiedSuccessCount = 0;

export function recordCrossTargetContamination(requested: string, actual: string): void {
  crossTargetContaminationCount++;
  logger.error('[CROSS_TARGET_CONTAMINATION] Prevented content crossover!', { requested, actual });
}

export function recordWrongTargetRead(requestedChat: string, actualChat: string): void {
  wrongTargetReadsCount++;
  logger.error('[WRONG_TARGET_READ] Prevented wrong-target read!', { requestedChat, actualChat });
}

export function recordUnverifiedSuccessAttempt(action: string, reason: string): void {
  unverifiedSuccessCount++;
  logger.error('[UNVERIFIED_SUCCESS] Blocked unverified success claim!', { action, reason });
}

export function getCrossTargetContaminationCount(): number {
  return crossTargetContaminationCount;
}

export function getWrongTargetReadsCount(): number {
  return wrongTargetReadsCount;
}

export function getUnverifiedSuccessCount(): number {
  return unverifiedSuccessCount;
}

export function resetVerificationCounters(): void {
  crossTargetContaminationCount = 0;
  wrongTargetReadsCount = 0;
  unverifiedSuccessCount = 0;
}

export class SourceOutcomeVerifier {
  private static instance: SourceOutcomeVerifier;

  private constructor() {}

  public static getInstance(): SourceOutcomeVerifier {
    if (!SourceOutcomeVerifier.instance) {
      SourceOutcomeVerifier.instance = new SourceOutcomeVerifier();
    }
    return SourceOutcomeVerifier.instance;
  }

  /**
   * Evaluates content acquisition result against requested intent and resolved target evidence.
   */
  public verifyContentAcquisition(
    intent: CompiledTurnIntent,
    target: ResolvedTargetEvidence,
    acquisition: UniversalAcquisitionResult
  ): SourceVerificationEvaluation {
    if (!acquisition.success) {
      const wrongChat = Boolean((acquisition.verificationEvidence as any)?.wrongChatDetected);
      if (wrongChat) {
        recordWrongTargetRead(intent.target || 'Agentic OS bot', acquisition.sourceChat || acquisition.sourceWindow);
      }
      return {
        isVerified: false,
        failureReason: acquisition.error || 'Content acquisition failed.',
        crossTargetContaminationDetected: false,
        wrongTargetReadDetected: wrongChat,
        unverifiedSuccessDetected: false,
      };
    }

    const requestedApp = (intent.application || target.resolvedApplication || '').toLowerCase();
    const sourceApp = (acquisition.sourceApplication || '').toLowerCase();
    const requestedTarget = (intent.target || target.requestedTarget || '').toLowerCase();

    const rawWindow = (acquisition.sourceWindow || '').toLowerCase();
    const rawContent = (acquisition.content || '').toLowerCase();

    const isScreenQuery = intent.targetType === 'SCREEN' || requestedApp === 'screen' || requestedTarget === 'screen';

    // For explicit current-screen requests, the physical foreground window was authoritatively locked into TargetIdentity
    if (isScreenQuery) {
      if (rawWindow.includes('null client input sync window')) {
        return {
          isVerified: false,
          failureReason: 'Foreground window is an internal sync window with no visible user content.',
          crossTargetContaminationDetected: false,
          wrongTargetReadDetected: false,
          unverifiedSuccessDetected: false,
        };
      }
      return {
        isVerified: true,
        crossTargetContaminationDetected: false,
        wrongTargetReadDetected: false,
        unverifiedSuccessDetected: false,
      };
    }

    // 1. Cross-Target Contamination Check: Window Chrome & AgenticOS Internal Sync Window Rejection
    const isInternalSyncWindow =
      rawWindow.includes('null client input') ||
      rawWindow.includes('sync window') ||
      rawContent.includes('null client input sync window');

    if (isInternalSyncWindow) {
      recordCrossTargetContamination(requestedApp || requestedTarget, acquisition.sourceWindow);
      return {
        isVerified: false,
        failureReason: `Captured source window '${acquisition.sourceWindow}' is an internal sync window with no visible user content.`,
        crossTargetContaminationDetected: true,
        wrongTargetReadDetected: true,
        unverifiedSuccessDetected: false,
      };
    }

    // 1b. Physical Cross-Target Contamination: AgenticOS Electron Process Rejection
    // Cross-target contamination is based primarily on physical identity (process, PID, HWND, application).
    // A Telegram window displaying a chat named "AgenticOS" (e.g. title "?AgenticOS – (89)") is legitimate Telegram.
    const actualProcess = (acquisition.targetIdentity?.processName || target.processName || acquisition.sourceApplication || '').toLowerCase();
    const isTelegramProcess = actualProcess.includes('telegram') || sourceApp.includes('telegram');
    const isAgenticProcess = actualProcess.includes('agenticos') || actualProcess.includes('electron') || (sourceApp.includes('agenticos') && !isTelegramProcess);
    const isAgenticRequested = requestedApp.includes('agentic') || requestedTarget.includes('agentic');

    if (isAgenticProcess && !isAgenticRequested) {
      recordCrossTargetContamination(requestedApp || requestedTarget, acquisition.sourceWindow || acquisition.sourceApplication);
      return {
        isVerified: false,
        failureReason: `Captured source application is AgenticOS Electron process, which does not match requested target '${requestedApp || requestedTarget}'.`,
        crossTargetContaminationDetected: true,
        wrongTargetReadDetected: true,
        unverifiedSuccessDetected: false,
      };
    }

    // 2. Cross-Target Contamination Check: Antigravity / System IDE Source Rejection
    const isAntigravitySource = sourceApp.includes('antigravity') || rawWindow.includes('antigravity') || rawWindow.includes('antigravity ide');
    const isAntigravityRequested = requestedApp.includes('antigravity') || requestedTarget.includes('antigravity');
    if (isAntigravitySource && !isAntigravityRequested) {
      recordCrossTargetContamination(requestedApp || requestedTarget || 'target', acquisition.sourceWindow || acquisition.sourceApplication);
      return {
        isVerified: false,
        failureReason: `Captured source window '${acquisition.sourceWindow}' is Antigravity IDE, which does not match requested target '${requestedApp || requestedTarget}'.`,
        crossTargetContaminationDetected: true,
        wrongTargetReadDetected: true,
        unverifiedSuccessDetected: false,
      };
    }

    // 3. Generic Application Identity Verification:
    // If a specific application was requested, the acquired source application MUST match
    if (requestedApp && sourceApp && !['screen', 'desktop', 'context', 'window'].includes(requestedApp) && !['screen', 'desktop', 'context', 'window'].includes(sourceApp)) {
      const cleanReq = requestedApp.replace(/\.exe$/i, '').trim();
      const cleanSrc = sourceApp.replace(/\.exe$/i, '').trim();
      const appMatches =
        cleanSrc.includes(cleanReq) ||
        cleanReq.includes(cleanSrc) ||
        (cleanReq === 'word' && (cleanSrc.includes('winword') || cleanSrc.includes('word'))) ||
        (cleanReq === 'telegram' && cleanSrc.includes('telegram')) ||
        (cleanReq === 'chrome' && cleanSrc.includes('chrome')) ||
        (cleanReq === 'pdf' && (cleanSrc.includes('msedge') || cleanSrc.includes('acrobat') || cleanSrc.includes('pdf')));

      if (!appMatches) {
        recordCrossTargetContamination(requestedApp, acquisition.sourceApplication || acquisition.sourceWindow);
        return {
          isVerified: false,
          failureReason: `Captured source application '${acquisition.sourceApplication}' does not match requested application '${requestedApp}'.`,
          crossTargetContaminationDetected: true,
          wrongTargetReadDetected: true,
          unverifiedSuccessDetected: false,
        };
      }
    }

    // 4. Authoritative Window Handle (HWND) Match
    if (target.windowHandle && acquisition.sourceHwnd && target.windowHandle !== acquisition.sourceHwnd) {
      recordCrossTargetContamination(`HWND:${target.windowHandle}`, `HWND:${acquisition.sourceHwnd}`);
      return {
        isVerified: false,
        failureReason: `Captured window handle (${acquisition.sourceHwnd}) does not match target window handle (${target.windowHandle}).`,
        crossTargetContaminationDetected: true,
        wrongTargetReadDetected: true,
        unverifiedSuccessDetected: false,
      };
    }

    // 2. Chat Target Verification Check (e.g. Telegram Desktop)
    if (intent.action === 'READ_MESSAGES' || intent.targetType === 'CHAT_CONVERSATION' || (intent.targetType as string) === 'CHAT') {
      const requestedChat = (intent.target || 'Agentic OS bot').toLowerCase();
      const actualChat = (acquisition.sourceChat || acquisition.sourceWindow || '').toLowerCase();
      const sourceAppLower = (acquisition.sourceApplication || '').toLowerCase();

      // Reject non-chat application windows (e.g. Hermes One, Chrome, Antigravity) from matching as chat
      const isForeignNonChat =
        sourceAppLower.includes('chrome') ||
        sourceAppLower.includes('hermes') ||
        sourceAppLower.includes('antigravity') ||
        actualChat.includes('hermes one') ||
        actualChat.includes('google chrome') ||
        actualChat.includes('antigravity');

      // Check if actualChat matches requestedChat
      const cleanReq = requestedChat.replace(/\s+bot$/i, '').trim();
      const isCorrectChat = !isForeignNonChat && (
        actualChat.includes(cleanReq) ||
        (cleanReq.includes('agentic') && (actualChat.includes('agenticos') || actualChat.includes('agentic os')))
      );

      if (!isCorrectChat) {
        recordWrongTargetRead(intent.target || 'Agentic OS bot', acquisition.sourceChat || acquisition.sourceWindow);
        const appName = intent.application || 'Telegram';
        const targetDesc = intent.target || 'Agentic OS bot';
        return {
          isVerified: false,
          failureReason: `${appName} is open, but I could not locate and verify the ${targetDesc} conversation.`,
          outputText: `${appName} is open, but I could not locate and verify the ${targetDesc} conversation.`,
          crossTargetContaminationDetected: false,
          wrongTargetReadDetected: true,
          unverifiedSuccessDetected: false,
        };
      }
    }

    // 3. Web Target Verification Check (e.g. Chrome -> YouTube / Specific Site)
    if ((intent.action as string) === 'READ_WEB_CONTENT' || intent.targetType === 'WEB_URL' || (intent.targetType as string) === 'BROWSER') {
      const requestedSite = (intent.target || target.requestedTarget || '').toLowerCase().trim();
      const sourceWindow = (acquisition.sourceWindow || '').toLowerCase();
      const sourceUrl = (acquisition.sourceUrl || '').toLowerCase();

      const cleanSite = requestedSite.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
      const isGenericBrowserRequest =
        requestedSite === 'chrome' ||
        requestedSite === 'google chrome' ||
        requestedSite === 'browser' ||
        requestedSite === 'the browser' ||
        requestedSite === 'current_page' ||
        requestedSite === 'this page' ||
        requestedSite === 'the current page' ||
        requestedSite === 'the page' ||
        requestedSite === 'active tab' ||
        requestedSite.includes('active tab') ||
        requestedSite.includes('current tab') ||
        requestedSite.includes('webpage') ||
        requestedSite.includes('this page') ||
        requestedSite.includes('current_page') ||
        requestedSite.includes('current page') ||
        requestedSite.includes('window');

      const matchesSite =
        isGenericBrowserRequest ||
        (cleanSite &&
          (sourceWindow.includes(cleanSite) ||
            sourceUrl.includes(cleanSite) ||
            (cleanSite.includes('youtube') && (sourceWindow.includes('youtube') || sourceUrl.includes('youtube'))) ||
            (cleanSite.includes('google') && (sourceWindow.includes('google') || sourceUrl.includes('google')))));

      if (cleanSite && !matchesSite) {
        recordWrongTargetRead(intent.target || target.requestedTarget || '', acquisition.sourceWindow);
        return {
          isVerified: false,
          failureReason: `Browser is open, but I could not verify page content for ${intent.target || target.requestedTarget}.`,
          outputText: `Chrome is open, but the active tab does not match ${intent.target || target.requestedTarget}.`,
          crossTargetContaminationDetected: false,
          wrongTargetReadDetected: true,
          unverifiedSuccessDetected: false,
        };
      }
    }

    // 4. Exact Window Title Check for specific window targets
    if (requestedTarget.includes('hermes 1') || requestedTarget.includes('hermes one')) {
      const windowTitle = (acquisition.sourceWindow || '').toLowerCase();
      if (!windowTitle.includes('one') && !windowTitle.includes('1')) {
        recordWrongTargetRead(requestedTarget, acquisition.sourceWindow);
        return {
          isVerified: false,
          failureReason: `Captured source window '${acquisition.sourceWindow}' does not match requested 'Hermes 1'.`,
          crossTargetContaminationDetected: false,
          wrongTargetReadDetected: true,
          unverifiedSuccessDetected: false,
        };
      }
    }

    return {
      isVerified: true,
      crossTargetContaminationDetected: false,
      wrongTargetReadDetected: false,
      unverifiedSuccessDetected: false,
    };
  }

  /**
   * Evaluates overall step result to ensure no unverified success is claimed.
   */
  public verifyStepOutcome(
    intent: CompiledTurnIntent,
    target: ResolvedTargetEvidence,
    result: ExecutionStepResult
  ): SourceVerificationEvaluation {
    if (result.success && !result.verified) {
      recordUnverifiedSuccessAttempt(intent.action, result.failureReason || 'Optimistic unverified execution');
      return {
        isVerified: false,
        failureReason: result.failureReason || `Step '${intent.action}' reported success but post-condition verification failed.`,
        crossTargetContaminationDetected: false,
        wrongTargetReadDetected: false,
        unverifiedSuccessDetected: true,
      };
    }

    return {
      isVerified: result.success && result.verified,
      failureReason: result.failureReason,
      outputText: result.outputText,
      crossTargetContaminationDetected: false,
      wrongTargetReadDetected: false,
      unverifiedSuccessDetected: false,
    };
  }
}

export const sourceOutcomeVerifier = SourceOutcomeVerifier.getInstance();
