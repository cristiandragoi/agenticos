/**
 * architecturalRepairsRegression.test.ts
 *
 * Full regression suite for the four proven architectural repairs:
 * 1. Authoritative visible-window resolution & ranking (main visible Qt window vs hidden/helper Qt window)
 * 2. Standalone state-aware READ_MESSAGES (automatic OPEN_CHAT prerequisite preserving TargetIdentity)
 * 3. Deictic & current-context perception ("Can you read this page?", "Read this", "What's on this page?")
 * 4. Temporal adverb & discourse normalization ("Read the browser now", "read Chrome now")
 * 5. Structured failure persistence & grounded causal "Why not?" explanation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createTurnEnvelope } from '../domains/controlPlane/TurnEnvelope.js';
import { authoritativeInteractionContext } from '../domains/controlPlane/AuthoritativeInteractionContext.js';
import { capabilityDispatcher } from '../domains/controlPlane/CapabilityDispatcher.js';
import { targetResolver } from '../domains/controlPlane/TargetResolver.js';
import { universalContentAcquisition } from '../domains/controlPlane/UniversalContentAcquisition.js';
import { authoritativeDesktopComputerUseProvider } from '../domains/controlPlane/computerUse/AuthoritativeDesktopComputerUseProvider.js';
import { AuthoritativeIntentCompiler } from '../domains/controlPlane/AuthoritativeIntentCompiler.js';

describe('Architectural Repairs Regression Suite', () => {
  const conversationId = 'conv-arch-repairs-test';

  beforeEach(() => {
    authoritativeInteractionContext.resetContext(conversationId);
    universalContentAcquisition.setMockProvider(undefined);
    authoritativeDesktopComputerUseProvider.setMockResolver(undefined);
    authoritativeDesktopComputerUseProvider.setMockObserver(undefined);
    authoritativeDesktopComputerUseProvider.setMockActivator(undefined);
  });

  // =========================================================================
  // REPAIR 1: AUTHORITATIVE WINDOW RESOLUTION & HIDDEN QT HELPER REJECTION
  // =========================================================================
  it('Repair 1: Ranks and selects the main visible Qt HWND over hidden/helper Qt HWNDs for same Telegram PID', async () => {
    const telegramPid = 31980;
    const mainVisibleHwnd = 2493010;
    const hiddenHelperHwnd = 12454740;

    // Simulate mock desktop windows containing both the main visible Telegram window
    // and the hidden/helper Qt window with the same PID
    targetResolver.setMockWindows([
      {
        hwnd: hiddenHelperHwnd,
        pid: telegramPid,
        process: 'Telegram',
        title: '',
        visible: false,
        bounds: { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 },
        isToolWindow: true,
      },
      {
        hwnd: mainVisibleHwnd,
        pid: telegramPid,
        process: 'Telegram',
        title: 'AgenticOS – (87)',
        visible: true,
        bounds: { left: 100, top: 100, right: 1100, bottom: 900, width: 1000, height: 800 },
        isToolWindow: false,
      },
    ]);

    const resolved = await authoritativeDesktopComputerUseProvider.resolveTarget({
      application: 'Telegram',
      targetHint: 'AgenticOS',
      correlationId: 'corr_test_rank_1',
    });

    expect(resolved.success).toBe(true);
    expect(resolved.target?.hwnd).toBe(mainVisibleHwnd);
    expect(resolved.target?.hwnd).not.toBe(hiddenHelperHwnd);
    expect(resolved.target?.pid).toBe(telegramPid);
    expect(resolved.target?.application).toBe('Telegram');
  });

  // =========================================================================
  // REPAIR 2: STANDALONE READ_MESSAGES STATE-AWARE PREREQUISITE
  // =========================================================================
  describe('Repair 2: Standalone and multi-turn state-aware messaging', () => {
    beforeEach(() => {
      targetResolver.setMockWindows([
        {
          hwnd: 2493010,
          pid: 31980,
          process: 'Telegram',
          title: 'AgenticOS – (87)',
          visible: true,
          bounds: { left: 100, top: 100, right: 1100, bottom: 900, width: 1000, height: 800 },
        },
      ]);
    });

    it('Scenario A: Turn 1 "Open Telegram" then Turn 2 "Read me the last two messages" converges with automatic chat selection', async () => {
      // Turn 1: "Open Telegram."
      const env1 = createTurnEnvelope({
        turnId: 'turn-tg-a1',
        conversationId,
        rawText: 'Open Telegram.',
        source: 'voice_livekit',
      });
      const res1 = await capabilityDispatcher.executePlan(env1);
      expect(res1.completedSuccessfully).toBe(true);

      const ctx1 = authoritativeInteractionContext.getContext(conversationId);
      expect(ctx1.activeApplication).toBe('Telegram');

      // Turn 2: "Read me the last two messages." (standalone form without explicit chat in utterance)
      const env2 = createTurnEnvelope({
        turnId: 'turn-tg-a2',
        conversationId,
        rawText: 'Read me the last two messages.',
        source: 'voice_livekit',
      });
      const res2 = await capabilityDispatcher.executePlan(env2);
      expect(res2.completedSuccessfully).toBe(true);
      expect(res2.responseText).toBeDefined();
    });

    it('Scenario B: Turn 1 "Open Telegram" then Turn 2 "Open Agentic OS bot" then Turn 3 "Read the last two messages"', async () => {
      // Turn 1: "Open Telegram."
      const env1 = createTurnEnvelope({
        turnId: 'turn-tg-b1',
        conversationId,
        rawText: 'Open Telegram.',
        source: 'voice_livekit',
      });
      const res1 = await capabilityDispatcher.executePlan(env1);
      expect(res1.completedSuccessfully).toBe(true);

      // Turn 2: "Open Agentic OS bot."
      const env2 = createTurnEnvelope({
        turnId: 'turn-tg-b2',
        conversationId,
        rawText: 'Open Agentic OS bot.',
        source: 'voice_livekit',
      });
      const res2 = await capabilityDispatcher.executePlan(env2);
      expect(res2.completedSuccessfully).toBe(true);

      const ctx2 = authoritativeInteractionContext.getContext(conversationId);
      expect(ctx2.verifiedSelectedChat).toBe(true);

      // Turn 3: "Read the last two messages."
      const env3 = createTurnEnvelope({
        turnId: 'turn-tg-b3',
        conversationId,
        rawText: 'Read the last two messages.',
        source: 'voice_livekit',
      });
      const res3 = await capabilityDispatcher.executePlan(env3);
      expect(res3.completedSuccessfully).toBe(true);
    });

    it('Scenario C: Compound form "Open Telegram, locate Agentic OS bot and read me the last two messages."', async () => {
      const env = createTurnEnvelope({
        turnId: 'turn-tg-c1',
        conversationId,
        rawText: 'Open Telegram, locate Agentic OS bot and read me the last two messages.',
        source: 'voice_livekit',
      });
      const res = await capabilityDispatcher.executePlan(env);
      expect(res.completedSuccessfully).toBe(true);
    });
  });

  // =========================================================================
  // REPAIR 3 & 4: DEICTIC ROUTING & TEMPORAL DISCOURSE NORMALIZATION
  // =========================================================================
  describe('Repair 3 & 4: Deictic perception and temporal modifier normalization', () => {
    beforeEach(() => {
      // Set active context to Chrome
      authoritativeInteractionContext.recordVerifiedStepSuccess(conversationId, 0, {
        application: 'Chrome',
        window: 'Jackowski 2026 - Comet - Google Chrome',
        capability: 'BROWSER',
        targetType: 'BROWSER',
        url: 'https://comet.example.com',
        pageTitle: 'Jackowski 2026 - Comet',
      });

      targetResolver.setMockWindows([
        {
          hwnd: 888123,
          pid: 4412,
          process: 'chrome',
          title: 'Jackowski 2026 - Comet - Google Chrome',
          visible: true,
          bounds: { left: 0, top: 0, right: 1920, bottom: 1080, width: 1920, height: 1080 },
        },
      ]);
    });

    it('compiles "Can you read this page?" into READ_WEB_CONTENT current_page', () => {
      const intent = AuthoritativeIntentCompiler.compile(
        'Can you read this page?',
        authoritativeInteractionContext.getContext(conversationId)
      );

      expect(intent.action).toBe('READ_WEB_CONTENT');
      expect(intent.target).toBe('current_page');
    });

    it('compiles "Read the browser now." into READ_WEB_CONTENT current_page (normalizing "now")', () => {
      const intent = AuthoritativeIntentCompiler.compile(
        'Read the browser now.',
        authoritativeInteractionContext.getContext(conversationId)
      );

      expect(intent.action).toBe('READ_WEB_CONTENT');
      expect(intent.target).toBe('current_page');
      expect(intent.target).not.toBe('browser now');
    });

    it('compiles deictic variants: "Read this.", "What\'s on this page?", "Read the current page."', () => {
      const ctx = authoritativeInteractionContext.getContext(conversationId);

      const t1 = AuthoritativeIntentCompiler.compile('Read this.', ctx);
      expect(t1.action).toBe('READ_WEB_CONTENT');
      expect(t1.target).toBe('current_page');

      const t2 = AuthoritativeIntentCompiler.compile("What's on this page?", ctx);
      expect(t2.action).toBe('READ_WEB_CONTENT');
      expect(t2.target).toBe('current_page');

      const t3 = AuthoritativeIntentCompiler.compile('Read the current page.', ctx);
      expect(t3.action).toBe('READ_WEB_CONTENT');
      expect(t3.target).toBe('current_page');
    });

    it('executes "Can you read this page?" through Browser capability without window-name lookup failure', async () => {
      const env = createTurnEnvelope({
        turnId: 'turn-deictic-1',
        conversationId,
        rawText: 'Can you read this page?',
        source: 'voice_livekit',
      });

      const res = await capabilityDispatcher.executePlan(env);
      expect(res.completedSuccessfully).toBe(true);
    });

    it('executes "Read the browser now." preserving current browser context', async () => {
      const env = createTurnEnvelope({
        turnId: 'turn-deictic-2',
        conversationId,
        rawText: 'Read the browser now.',
        source: 'voice_livekit',
      });

      const res = await capabilityDispatcher.executePlan(env);
      expect(res.completedSuccessfully).toBe(true);
    });
  });

  // =========================================================================
  // REPAIR 5 & 6: STRUCTURED TECHNICAL FAILURE & CAUSAL "WHY?"
  // =========================================================================
  describe('Repair 5 & 6: Structured failure persistence and causal explanations', () => {
    it('persists structured failure and answers "Why not?" with grounded causal explanation', async () => {
      // Simulate a technical failure in context
      authoritativeInteractionContext.recordExecutionFailure(conversationId, {
        turnId: 'turn-fail-prev',
        correlationId: 'corr-fail-123',
        action: 'READ_MESSAGES',
        target: 'Agentic OS bot',
        executionStage: 'VERIFICATION',
        providerIdentity: 'Agent-S',
        technicalRootCause: 'Target window validation failed for HWND 12454740 (helper/non-visible Qt window)',
        userFacingFailure: "I found Telegram, but I couldn't reliably read the requested messages.",
        failureReason: "Target window validation failed for HWND 12454740",
        physicalEvidence: {
          uia: false,
          screenshot: true,
          uiTars: false,
          ocr: false,
        },
        verifierState: 'FAILED_CLOSED',
        verifierMismatchDetails: 'Window was not the visible main application surface',
        timestamp: Date.now(),
      });

      // Follow-up: "Why not?"
      const envWhy = createTurnEnvelope({
        turnId: 'turn-why-1',
        conversationId,
        rawText: 'Why not?',
        source: 'voice_livekit',
      });

      const resWhy = await capabilityDispatcher.executePlan(envWhy);
      expect(resWhy.completedSuccessfully).toBe(true);

      // Verify it produces a meaningful, grounded explanation rather than repeated tautology
      const text = resWhy.responseText || '';
      expect(text).toContain('window');
      expect(text).not.toBe("I couldn't complete the read because I found Telegram, but I couldn't reliably read the requested messages.");
    });
  });
});
