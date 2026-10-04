/**
 * phase4ControlPlaneRetirement.test.ts — Phase 4 Control-Plane Retirement & Invariant Verification
 *
 * VALIDATES:
 * 1. Exactly ONE semantic authority: AuthoritativeIntentCompiler.
 * 2. Exactly ONE current-interaction state authority: AuthoritativeInteractionContext.
 * 3. Exactly ONE direct execution authority: CapabilityDispatcher.
 * 4. Zero legacy execution escapes (LEGACY_EXECUTION_ESCAPE === 0).
 * 5. Zero intent override attempts (INTENT_OVERRIDE_ATTEMPT === 0).
 * 6. Exactly 1 compile per user turn (AUTHORITATIVE_INTENT_COMPILE_COUNT === 1).
 * 7. Exactly 1 direct dispatch per direct plan (DIRECT_DISPATCH_COUNT === 1).
 * 8. Zero direct turns reaching understand.ts (getDirectTurnsReachingUnderstandCount() === 0).
 * 9. Real top-level ingress path testing via turnLifecycle.submit for all 6 required end-to-end flows.
 */

import { describe, it, expect, beforeEach, vi, beforeAll } from 'vitest';
import {
  capabilityDispatcher,
  getDirectDispatchCount,
  resetDirectDispatchCount,
  getLegacyExecutionEscapeCount,
  resetLegacyExecutionEscapeCount,
} from '../domains/controlPlane/CapabilityDispatcher.js';
import {
  AuthoritativeIntentCompiler,
  getAuthoritativeIntentCompileCount,
  resetAuthoritativeIntentCompileCount,
} from '../domains/controlPlane/AuthoritativeIntentCompiler.js';
import {
  authoritativeInteractionContext,
  getWritableInteractionContextOwnersCount,
} from '../domains/controlPlane/AuthoritativeInteractionContext.js';
import {
  getIntentOverrideAttemptsCount,
  resetIntentOverrideAttemptsCount,
} from '../domains/controlPlane/TurnEnvelope.js';
import {
  getDirectTurnsReachingUnderstandCount,
  resetDirectTurnsReachingUnderstandCount,
} from '../domains/turnLifecycle/understand.js';
import {
  appCapabilityAdapter,
  chatCapabilityAdapter,
  perceptionCapabilityAdapter,
  browserCapabilityAdapter,
  delegationCapabilityAdapter,
} from '../domains/controlPlane/adapters/index.js';
import { turnLifecycle } from '../domains/turnLifecycle/index.js';
import { ensureTurnLifecycleTables } from '../domains/turnLifecycle/store.js';
import { jarvisOrchestrator } from '../domains/jarvis/orchestrator.js';

describe('Phase 4 — Control-Plane Retirement & Architectural Invariants', () => {
  beforeAll(() => {
    ensureTurnLifecycleTables();
  });

  beforeEach(() => {
    authoritativeInteractionContext.resetContext();
    resetLegacyExecutionEscapeCount();
    resetIntentOverrideAttemptsCount();
    resetAuthoritativeIntentCompileCount();
    resetDirectDispatchCount();
    resetDirectTurnsReachingUnderstandCount();
    vi.restoreAllMocks();
  });

  describe('1. Architectural Invariant Enforcement', () => {
    it('verifies instrumented invariant baseline counts', () => {
      expect(getWritableInteractionContextOwnersCount()).toBe(1);
      expect(getLegacyExecutionEscapeCount()).toBe(0);
      expect(getIntentOverrideAttemptsCount()).toBe(0);
      expect(getAuthoritativeIntentCompileCount()).toBe(0);
      expect(getDirectDispatchCount()).toBe(0);
      expect(getDirectTurnsReachingUnderstandCount()).toBe(0);
    });

    it('verifies that jarvisOrchestrator rejects direct interactions', async () => {
      const res = await jarvisOrchestrator.handleMessage(
        'conv-direct-guard',
        'Open Telegram',
        'D:\\AgenticOS',
        'manual',
        'op-guard-1'
      );
      expect(res.status).toBe('failed');
      expect(res.route).toBe('direct_rejected');
      expect(res.error).toContain('cannot be routed through jarvisOrchestrator');
    });
  });

  describe('2. End-to-End Real Ingress Flows via turnLifecycle.submit', () => {
    // Flow 1: "Read what is inside Antigravity." -> "Read point two."
    it('Flow 1: Reads Antigravity content snapshot and resolves point two via ordinal continuation', async () => {
      const convId = 'conv-e2e-flow-1';

      // Mock Perception adapter for read snapshot and point resolution
      vi.spyOn(perceptionCapabilityAdapter, 'readContent').mockImplementation(async (step, stepId, cid) => {
        if (step.ordinal === 2) {
          return {
            stepId,
            action: 'READ_CONTENT',
            requestedTarget: 'point 2',
            executedTarget: 'point 2',
            success: true,
            verified: true,
            verificationEvidence: {
              source: 'context_snapshot',
              label: 'Ordinal 2 resolved from snapshot',
              observedAt: Date.now(),
              data: { point: 2 },
            },
            contextMutation: {
              activeContentSnapshot: 'Point 2: Architecture replacement in progress.',
              ordinalTarget: 2,
            },
            outputText: 'Point two states: Architecture replacement in progress.',
          };
        }

        return {
          stepId,
          action: 'READ_CONTENT',
          requestedTarget: 'Antigravity',
          executedTarget: 'Antigravity',
          success: true,
          verified: true,
          verificationEvidence: {
            source: 'desktop_perception',
            label: 'Extracted Antigravity snapshot',
            observedAt: Date.now(),
            data: { linesCount: 3 },
          },
          contextMutation: {
            application: 'Antigravity',
            activeContentSnapshot: '1. First item.\n2. Architecture replacement in progress.\n3. Third item.',
            targetType: 'APPLICATION',
          },
          outputText: 'Here is what is inside Antigravity: 1. First item, 2. Architecture replacement, 3. Third item.',
        };
      });

      // Turn 1
      resetAuthoritativeIntentCompileCount();
      resetDirectDispatchCount();
      const res1 = await turnLifecycle.submit({
        source: 'voice_livekit',
        conversationId: convId,
        text: 'Read what is inside Antigravity.',
      });

      expect(res1.record.outcome).toBe('VERIFIED');
      expect(res1.record.envelope?.compiledIntent.action).toBe('READ_CONTENT');
      expect(res1.record.envelope?.compiledIntent.application).toBe('Antigravity');
      expect(getAuthoritativeIntentCompileCount()).toBe(1);
      expect(getDirectDispatchCount()).toBe(1);
      expect(getDirectTurnsReachingUnderstandCount()).toBe(0);

      // Turn 2
      resetAuthoritativeIntentCompileCount();
      resetDirectDispatchCount();
      const res2 = await turnLifecycle.submit({
        source: 'voice_livekit',
        conversationId: convId,
        text: 'Read point two.',
      });

      expect(res2.record.outcome).toBe('VERIFIED');
      expect(res2.record.envelope?.compiledIntent.action).toBe('READ_CONTENT');
      expect(res2.record.envelope?.compiledIntent.ordinal).toBe(2);
      expect(res2.record.responseText).toContain('Architecture replacement');
      expect(getAuthoritativeIntentCompileCount()).toBe(1);
      expect(getDirectDispatchCount()).toBe(1);
      expect(getDirectTurnsReachingUnderstandCount()).toBe(0);
      expect(getLegacyExecutionEscapeCount()).toBe(0);
    });

    // Flow 2: "Open Telegram and locate Agentic OS bot." -> "Read the last two messages."
    it('Flow 2: Compound Telegram open + chat locate followed by message reading', async () => {
      const convId = 'conv-e2e-flow-2';

      vi.spyOn(appCapabilityAdapter, 'execute').mockResolvedValueOnce({
        stepId: 'step-0',
        action: 'OPEN_APPLICATION',
        requestedTarget: 'Telegram',
        executedTarget: 'Telegram',
        success: true,
        verified: true,
        contextMutation: { application: 'Telegram', targetType: 'APPLICATION' },
        outputText: 'Opened Telegram.',
      });

      vi.spyOn(chatCapabilityAdapter, 'openChat').mockResolvedValueOnce({
        stepId: 'step-1',
        action: 'OPEN_CHAT',
        requestedTarget: 'Agentic OS bot',
        executedTarget: 'Agentic OS bot',
        success: true,
        verified: true,
        contextMutation: { application: 'Telegram', chat: 'Agentic OS bot', verifiedSelectedChat: true, targetType: 'CHAT' },
        outputText: 'Located and opened Agentic OS bot.',
      });

      vi.spyOn(chatCapabilityAdapter, 'readMessages').mockResolvedValueOnce({
        stepId: 'step-msg',
        action: 'READ_MESSAGES',
        requestedTarget: 'Agentic OS bot',
        executedTarget: 'Agentic OS bot',
        success: true,
        verified: true,
        contextMutation: {
          application: 'Telegram',
          chat: 'Agentic OS bot',
          verifiedSelectedChat: true,
          targetType: 'CHAT',
          messages: [{ id: 1, text: 'Hello' }, { id: 2, text: 'World' }],
        },
        outputText: 'The last two messages are: Hello, World.',
      });

      // Turn 1: Compound
      resetAuthoritativeIntentCompileCount();
      resetDirectDispatchCount();
      const res1 = await turnLifecycle.submit({
        source: 'voice_livekit',
        conversationId: convId,
        text: 'Open Telegram and locate Agentic OS bot.',
      });

      expect(res1.record.outcome).toBe('VERIFIED');
      expect(res1.record.envelope?.compiledPlan.length).toBe(2);
      expect(getAuthoritativeIntentCompileCount()).toBe(1);
      expect(getDirectDispatchCount()).toBe(1);

      // Verify interaction context state
      const ctx = authoritativeInteractionContext.getContext(convId);
      expect(ctx.activeApplication).toBe('Telegram');
      expect(ctx.activeChat).toBe('Agentic OS bot');
      expect(ctx.verifiedSelectedChat).toBe(true);

      // Turn 2: Read messages
      resetAuthoritativeIntentCompileCount();
      resetDirectDispatchCount();
      const res2 = await turnLifecycle.submit({
        source: 'voice_livekit',
        conversationId: convId,
        text: 'Read the last two messages.',
      });

      expect(res2.record.outcome).toBe('VERIFIED');
      expect(res2.record.envelope?.compiledIntent.action).toBe('READ_MESSAGES');
      expect(res2.record.envelope?.compiledIntent.count).toBe(2);
      expect(getAuthoritativeIntentCompileCount()).toBe(1);
      expect(getDirectDispatchCount()).toBe(1);
      expect(getLegacyExecutionEscapeCount()).toBe(0);
    });

    // Flow 3: "Open Chrome and open YouTube."
    it('Flow 3: Compound browser app launch and web navigation without perception drift', async () => {
      const convId = 'conv-e2e-flow-3';

      vi.spyOn(appCapabilityAdapter, 'execute').mockResolvedValueOnce({
        stepId: 'step-0',
        action: 'OPEN_APPLICATION',
        requestedTarget: 'Chrome',
        executedTarget: 'Google Chrome',
        success: true,
        verified: true,
        contextMutation: { application: 'Google Chrome', targetType: 'APPLICATION' },
        outputText: 'Opened Chrome.',
      });

      vi.spyOn(browserCapabilityAdapter, 'execute').mockResolvedValueOnce({
        stepId: 'step-1',
        action: 'NAVIGATE_WEB',
        requestedTarget: 'YouTube',
        executedTarget: 'https://youtube.com',
        success: true,
        verified: true,
        contextMutation: { browserUrl: 'https://youtube.com', activeDomain: 'youtube.com', targetType: 'BROWSER_TAB' },
        outputText: 'Navigated to YouTube.',
      });

      resetAuthoritativeIntentCompileCount();
      resetDirectDispatchCount();
      const res = await turnLifecycle.submit({
        source: 'voice_livekit',
        conversationId: convId,
        text: 'Open Chrome and open YouTube.',
      });

      expect(res.record.outcome).toBe('VERIFIED');
      expect(res.record.envelope?.compiledPlan.length).toBe(2);
      expect(res.record.envelope?.compiledPlan[0].action).toBe('OPEN_APPLICATION');
      expect(res.record.envelope?.compiledPlan[1].action).toBe('NAVIGATE_WEB');
      expect(getAuthoritativeIntentCompileCount()).toBe(1);
      expect(getDirectDispatchCount()).toBe(1);
      expect(getDirectTurnsReachingUnderstandCount()).toBe(0);
    });

    // Flow 4: "Open camera." -> "What am I holding?" -> "Open Telegram."
    it('Flow 4: Camera observation, object query, and clean application context switch', async () => {
      const convId = 'conv-e2e-flow-4';

      vi.spyOn(perceptionCapabilityAdapter, 'observeCamera').mockResolvedValue({
        stepId: 'step-cam',
        action: 'CAMERA_OBSERVE',
        requestedTarget: 'camera',
        executedTarget: 'camera',
        success: true,
        verified: true,
        contextMutation: { activeCameraFrame: 'frame-test-01.jpg', targetType: 'CAMERA' },
        outputText: 'Camera is active. I see you holding a blue pen.',
      });

      vi.spyOn(appCapabilityAdapter, 'execute').mockResolvedValueOnce({
        stepId: 'step-tg',
        action: 'OPEN_APPLICATION',
        requestedTarget: 'Telegram',
        executedTarget: 'Telegram',
        success: true,
        verified: true,
        contextMutation: { application: 'Telegram', targetType: 'APPLICATION' },
        outputText: 'Opened Telegram.',
      });

      // Turn 1: Open camera
      const res1 = await turnLifecycle.submit({
        source: 'voice_livekit',
        conversationId: convId,
        text: 'Open camera.',
      });
      expect(res1.record.outcome).toBe('VERIFIED');
      expect(res1.record.envelope?.compiledIntent.action).toBe('CAMERA_OBSERVE');

      // Turn 2: What am I holding?
      const res2 = await turnLifecycle.submit({
        source: 'voice_livekit',
        conversationId: convId,
        text: 'What am I holding?',
      });
      expect(res2.record.outcome).toBe('VERIFIED');
      expect(res2.record.envelope?.compiledIntent.action).toBe('CAMERA_OBSERVE');
      expect(res2.record.responseText).toContain('blue pen');

      // Turn 3: Open Telegram
      const res3 = await turnLifecycle.submit({
        source: 'voice_livekit',
        conversationId: convId,
        text: 'Open Telegram.',
      });
      expect(res3.record.outcome).toBe('VERIFIED');
      expect(res3.record.envelope?.compiledIntent.action).toBe('OPEN_APPLICATION');
      expect(res3.record.envelope?.compiledIntent.application).toBe('Telegram');

      const ctx = authoritativeInteractionContext.getContext(convId);
      expect(ctx.activeApplication).toBe('Telegram');
      expect(ctx.activeTargetType).toBe('APPLICATION');
      expect(getDirectTurnsReachingUnderstandCount()).toBe(0);
    });

    // Flow 5: "Read Antigravity." -> "Delegate this problem to Antigravity."
    it('Flow 5: Strict boundary separation between reading Antigravity vs delegating to Antigravity', async () => {
      const convId = 'conv-e2e-flow-5';

      vi.spyOn(perceptionCapabilityAdapter, 'readContent').mockResolvedValueOnce({
        stepId: 'step-read-ag',
        action: 'READ_CONTENT',
        requestedTarget: 'Antigravity',
        executedTarget: 'Antigravity',
        success: true,
        verified: true,
        contextMutation: { application: 'Antigravity', activeContentSnapshot: 'Active IDE workspace', targetType: 'APPLICATION' },
        outputText: 'Reading Antigravity workspace content.',
      });

      vi.spyOn(delegationCapabilityAdapter, 'execute').mockResolvedValueOnce({
        stepId: 'step-del-ag',
        action: 'DELEGATE',
        requestedTarget: 'antigravity',
        executedTarget: 'antigravity',
        success: true,
        verified: true,
        contextMutation: { lastCompletedAction: 'DELEGATE' },
        outputText: 'Delegated task to Antigravity: task created and accepted.',
      });

      // Turn 1: Read Antigravity (must NEVER be delegation!)
      const res1 = await turnLifecycle.submit({
        source: 'voice_livekit',
        conversationId: convId,
        text: 'Read Antigravity.',
      });
      expect(res1.record.outcome).toBe('VERIFIED');
      expect(res1.record.envelope?.compiledIntent.action).toBe('READ_CONTENT');
      expect(res1.record.envelope?.compiledIntent.delegationRequested).toBe(false);

      // Turn 2: Delegate this problem to Antigravity (delegation IS true)
      const res2 = await turnLifecycle.submit({
        source: 'voice_livekit',
        conversationId: convId,
        text: 'Delegate this problem to Antigravity.',
      });
      expect(res2.record.outcome).toBe('VERIFIED');
      expect(res2.record.envelope?.compiledIntent.action).toBe('DELEGATE');
      expect(res2.record.envelope?.compiledIntent.delegationRequested).toBe(true);
      expect(res2.record.envelope?.compiledIntent.worker).toBe('antigravity');
      expect(getDirectTurnsReachingUnderstandCount()).toBe(0);
      expect(getLegacyExecutionEscapeCount()).toBe(0);
    });

    // Flow 6: Force Telegram chat verification failure
    it('Flow 6: Forces Telegram chat verification failure and verifies clean failure with zero fallbacks', async () => {
      const convId = 'conv-e2e-flow-6';

      vi.spyOn(appCapabilityAdapter, 'execute').mockResolvedValueOnce({
        stepId: 'step-0',
        action: 'OPEN_APPLICATION',
        requestedTarget: 'Telegram',
        executedTarget: 'Telegram',
        success: true,
        verified: true,
        contextMutation: { application: 'Telegram', targetType: 'APPLICATION' },
        outputText: 'Opened Telegram.',
      });

      // Force failure on locating the nonexistent chat
      vi.spyOn(chatCapabilityAdapter, 'openChat').mockResolvedValueOnce({
        stepId: 'step-1',
        action: 'OPEN_CHAT',
        requestedTarget: 'Nonexistent Secret Bot',
        success: false,
        verified: false,
        failureReason: "Verification failed: Could not locate chat 'Nonexistent Secret Bot' in Telegram desktop.",
      });

      const res = await turnLifecycle.submit({
        source: 'voice_livekit',
        conversationId: convId,
        text: 'Open Telegram and locate Nonexistent Secret Bot.',
      });

      // Invariants when verification fails:
      expect(res.record.outcome).toBe('FAILED');
      expect(res.record.outcomeReason).toContain("Could not locate chat 'Nonexistent Secret Bot'");

      // Assertions per prompt:
      // 1. no wrong chat is read (chat is NOT verified)
      const ctx = authoritativeInteractionContext.getContext(convId);
      expect(ctx.verifiedSelectedChat).toBe(false);
      expect(ctx.activeChat).toBeNull();

      // 2. no orchestrator fallback
      expect(res.record.handler).toBe('controlPlane.CapabilityDispatcher');

      // 3. no web Telegram fallback
      expect(ctx.activeDomain).toBeFalsy();
      expect(ctx.browserUrl).toBeFalsy();

      // 4. no worker delegation
      expect(res.record.envelope?.compiledIntent.delegationRequested).toBe(false);

      // 5. clean failure response
      expect(res.record.responseText).toContain('could not locate and verify');
      expect(res.record.outcomeReason).toContain("Could not locate chat 'Nonexistent Secret Bot'");

      // 6. counters
      expect(getLegacyExecutionEscapeCount()).toBe(0);
      expect(getDirectTurnsReachingUnderstandCount()).toBe(0);
    });
  });
});
