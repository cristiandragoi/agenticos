/**
 * phase3CapabilityDispatcher.test.ts — Verification of Phase 3 Control-Plane Replacement
 *
 * Validates:
 * 1. CapabilityDispatcher is the single execution authority for compiled plans.
 * 2. Sequential execution of compound plans.
 * 3. Stop-on-first-failure guarantee (never executes subsequent steps after failure).
 * 4. Atomic context updates via Verification Gateway.
 * 5. Scenario A: Telegram exact-chat verification & failure stop.
 * 6. Scenario B: Browser Chrome + YouTube compound execution without perception drift.
 * 7. Scenario C: Antigravity content ordinal continuation (never open application "point 2").
 * 8. Scenario D: Camera -> Chrome capability context switch.
 * 9. Scenario E: Explicit delegation isolation ("Read Antigravity" vs "Delegate to Antigravity").
 * 10. Scenario F: Compound 3-step failure stops step 3.
 * 11. LEGACY_EXECUTION_ESCAPE count === 0.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  capabilityDispatcher,
  CapabilityDispatcher,
  getLegacyExecutionEscapeCount,
  resetLegacyExecutionEscapeCount,
} from '../domains/controlPlane/CapabilityDispatcher.js';
import {
  authoritativeInteractionContext,
} from '../domains/controlPlane/AuthoritativeInteractionContext.js';
import {
  AuthoritativeIntentCompiler,
  type CompiledTurnIntent,
} from '../domains/controlPlane/AuthoritativeIntentCompiler.js';
import { createTurnEnvelope } from '../domains/controlPlane/TurnEnvelope.js';
import {
  appCapabilityAdapter,
  chatCapabilityAdapter,
  perceptionCapabilityAdapter,
  browserCapabilityAdapter,
  delegationCapabilityAdapter,
} from '../domains/controlPlane/adapters/index.js';
import { verificationGateway } from '../domains/controlPlane/VerificationGateway.js';
import { targetResolver } from '../domains/controlPlane/TargetResolver.js';

describe('Phase 3 — CapabilityDispatcher & Verification Gateway', () => {
  beforeEach(() => {
    authoritativeInteractionContext.resetContext();
    resetLegacyExecutionEscapeCount();
    vi.restoreAllMocks();
    targetResolver.setMockWindows([
      { hwnd: 133174, pid: 5904, process: 'Telegram', title: 'Agentic OS bot – Telegram' },
      { hwnd: 591440, pid: 38080, process: 'chrome', title: 'YouTube - Google Chrome' },
    ]);
  });

  describe('1. Architectural Foundation & Invariants', () => {
    it('CapabilityDispatcher is a single authoritative singleton instance', () => {
      const d1 = CapabilityDispatcher.getInstance();
      const d2 = CapabilityDispatcher.getInstance();
      expect(d1).toBe(d2);
      expect(d1).toBe(capabilityDispatcher);
    });

    it('maintains LEGACY_EXECUTION_ESCAPE count at 0', () => {
      expect(getLegacyExecutionEscapeCount()).toBe(0);
    });
  });

  describe('Scenario A: TELEGRAM Compound Execution & Stop-on-Failure', () => {
    const CONV_TG = 'conv-telegram-test';

    it('A.1 (Success): Executes 3-step Telegram compound plan and verifies all steps', async () => {
      // Plan: OPEN_APPLICATION Telegram -> OPEN_CHAT Agentic OS bot -> READ_MESSAGES count=2
      const rawUtterance = 'Open Telegram and locate Agentic OS bot and read the last 2 messages';
      const envelope = createTurnEnvelope({
        conversationId: CONV_TG,
        source: 'typed_http',
        rawText: rawUtterance,
      });

      expect(envelope.compiledPlan.length).toBeGreaterThanOrEqual(2);

      // Mock adapters for clean deterministic test
      vi.spyOn(appCapabilityAdapter, 'execute').mockResolvedValueOnce({
        stepId: 'step-0',
        action: 'OPEN_APPLICATION',
        requestedTarget: 'Telegram',
        executedTarget: 'Telegram',
        success: true,
        verified: true,
        verificationEvidence: {
          source: 'window_inspection',
          label: 'Telegram active',
          observedAt: Date.now(),
          data: { hwnd: 12345 },
        },
        contextMutation: {
          application: 'Telegram',
          window: 'Telegram',
          windowHandle: 12345,
          targetType: 'APPLICATION',
        },
        outputText: 'I have opened Telegram.',
      });

      vi.spyOn(chatCapabilityAdapter, 'openChat').mockResolvedValueOnce({
        stepId: 'step-1',
        action: 'OPEN_CHAT',
        requestedTarget: 'Agentic OS bot',
        executedTarget: 'Agentic OS bot',
        success: true,
        verified: true,
        verificationEvidence: {
          source: 'window_inspection',
          label: 'Agentic OS bot conversation selected',
          observedAt: Date.now(),
          data: { selected: true },
        },
        contextMutation: {
          application: 'Telegram',
          chat: 'Agentic OS bot',
          verifiedSelectedChat: true,
          targetType: 'CHAT',
        },
        outputText: 'I have opened and verified the Agentic OS bot conversation in Telegram.',
      });

      vi.spyOn(chatCapabilityAdapter, 'readMessages').mockResolvedValueOnce({
        stepId: 'step-2',
        action: 'READ_MESSAGES',
        requestedTarget: 'Agentic OS bot',
        executedTarget: 'Agentic OS bot',
        success: true,
        verified: true,
        verificationEvidence: {
          source: 'uia',
          label: 'Extracted 2 messages',
          observedAt: Date.now(),
          data: { count: 2 },
        },
        contextMutation: {
          application: 'Telegram',
          chat: 'Agentic OS bot',
          verifiedSelectedChat: true,
          targetType: 'CHAT',
          messages: [
            { id: 1, sender: 'AgenticOS', text: 'System ready.' },
            { id: 2, sender: 'Me', text: 'Hello.' },
          ],
        },
        outputText: 'Here are the last 2 messages in the Agentic OS bot chat.',
      });

      const res = await capabilityDispatcher.executePlan(envelope);

      expect(res.completedSuccessfully).toBe(true);
      expect(res.verifiedSteps.length).toBe(envelope.compiledPlan.length);
      expect(res.failedStep).toBeUndefined();

      // Verify atomic context update
      const ctx = authoritativeInteractionContext.getContext(CONV_TG);
      expect(ctx.activeApplication).toBe('Telegram');
      expect(ctx.activeChat).toBe('Agentic OS bot');
      expect(ctx.verifiedSelectedChat).toBe(true);
      expect(ctx.activeTargetType).toBe('CHAT');
      expect(ctx.planStatus).toBe('COMPLETED');
      expect(getLegacyExecutionEscapeCount()).toBe(0);
    });

    it('A.2 (Failure & Stop-on-First-Failure): Telegram opens but Agentic OS bot verification fails -> Step 3 NEVER executes', async () => {
      const rawUtterance = 'Open Telegram and locate Agentic OS bot and read the last 2 messages';
      const envelope = createTurnEnvelope({
        conversationId: CONV_TG + '-fail',
        source: 'typed_http',
        rawText: rawUtterance,
      });

      // Step 1 succeeds
      vi.spyOn(appCapabilityAdapter, 'execute').mockResolvedValueOnce({
        stepId: 'step-0',
        action: 'OPEN_APPLICATION',
        requestedTarget: 'Telegram',
        executedTarget: 'Telegram',
        success: true,
        verified: true,
        contextMutation: {
          application: 'Telegram',
          targetType: 'APPLICATION',
        },
        outputText: 'I have opened Telegram.',
      });

      // Step 2 fails verification (e.g. Telegram foreground but wrong chat / bot not found)
      vi.spyOn(chatCapabilityAdapter, 'openChat').mockResolvedValueOnce({
        stepId: 'step-1',
        action: 'OPEN_CHAT',
        requestedTarget: 'Agentic OS bot',
        executedTarget: null,
        success: false,
        verified: false,
        failureReason: 'Telegram is open, but I could not locate and verify the Agentic OS bot conversation.',
      });

      // Step 3 readMessages should NEVER be called
      const readSpy = vi.spyOn(chatCapabilityAdapter, 'readMessages');

      const res = await capabilityDispatcher.executePlan(envelope);

      expect(res.completedSuccessfully).toBe(false);
      expect(res.failedStep).toBeDefined();
      expect(res.failedStep?.stepIndex).toBe(1);
      expect(res.verifiedSteps.length).toBe(1); // Only step 1 verified

      // HARD INVARIANT: Step 3 NEVER executed
      expect(readSpy).not.toHaveBeenCalled();

      // Output text requirement
      expect(res.responseText).toContain('Telegram is open, but I could not locate and verify the Agentic OS bot conversation.');

      // Context check: activeChat must NOT be set, verifiedSelectedChat must be false
      const ctx = authoritativeInteractionContext.getContext(CONV_TG + '-fail');
      expect(ctx.activeApplication).toBe('Telegram');
      expect(ctx.activeChat).toBeNull();
      expect(ctx.verifiedSelectedChat).toBe(false);
      expect(ctx.planStatus).toBe('PARTIALLY_COMPLETED');
      expect(getLegacyExecutionEscapeCount()).toBe(0);
    });
  });

  describe('Scenario B: BROWSER Compound Plan (Chrome + YouTube)', () => {
    const CONV_BROWSER = 'conv-browser-test';

    it('Executes Chrome + YouTube compound plan without perception or camera continuation', async () => {
      const rawUtterance = 'Open Chrome and open YouTube';
      const envelope = createTurnEnvelope({
        conversationId: CONV_BROWSER,
        source: 'voice_livekit',
        rawText: rawUtterance,
      });

      expect(envelope.compiledPlan.length).toBe(2);
      expect(envelope.compiledPlan[0].action).toBe('OPEN_APPLICATION');
      expect(envelope.compiledPlan[1].action).toBe('NAVIGATE_WEB');

      vi.spyOn(appCapabilityAdapter, 'execute').mockResolvedValueOnce({
        stepId: 'step-0',
        action: 'OPEN_APPLICATION',
        requestedTarget: 'Chrome',
        executedTarget: 'Chrome',
        success: true,
        verified: true,
        contextMutation: {
          application: 'Chrome',
          targetType: 'APPLICATION',
        },
        outputText: 'I have opened Chrome.',
      });

      vi.spyOn(browserCapabilityAdapter, 'execute').mockResolvedValueOnce({
        stepId: 'step-1',
        action: 'NAVIGATE_WEB',
        requestedTarget: 'YouTube',
        executedTarget: 'https://www.youtube.com',
        success: true,
        verified: true,
        contextMutation: {
          application: 'Chrome',
          url: 'https://www.youtube.com',
          page: 'https://www.youtube.com',
          targetType: 'BROWSER',
          capability: 'BROWSER',
        },
        outputText: 'Navigated to https://www.youtube.com.',
      });

      // Ensure perception adapter was NOT called
      const perceptionSpy = vi.spyOn(perceptionCapabilityAdapter, 'execute');

      const res = await capabilityDispatcher.executePlan(envelope);

      expect(res.completedSuccessfully).toBe(true);
      expect(res.verifiedSteps.length).toBe(2);
      expect(perceptionSpy).not.toHaveBeenCalled();

      const ctx = authoritativeInteractionContext.getContext(CONV_BROWSER);
      expect(ctx.activeApplication).toBe('Chrome');
      expect(ctx.activeUrl).toBe('https://www.youtube.com');
      expect(ctx.activeCapability).toBe('BROWSER');
      expect(ctx.activeTargetType).toBe('BROWSER');
      expect(getLegacyExecutionEscapeCount()).toBe(0);
    });
  });

  describe('Scenario C: ANTIGRAVITY Content & Ordinal Continuation', () => {
    const CONV_CONTENT = 'conv-content-test';

    it('Turn 1 reads Antigravity, Turn 2 resolves ordinal 2 against context (never opens app "point 2")', async () => {
      // Turn 1: "Read what is inside Antigravity"
      const env1 = createTurnEnvelope({
        conversationId: CONV_CONTENT,
        source: 'voice_livekit',
        rawText: 'Read what is inside Antigravity',
      });

      vi.spyOn(perceptionCapabilityAdapter, 'execute').mockResolvedValueOnce({
        stepId: 'turn-1-step-0',
        action: 'READ_CONTENT',
        requestedTarget: 'Antigravity',
        executedTarget: 'Antigravity',
        success: true,
        verified: true,
        contextMutation: {
          application: 'Antigravity',
          target: 'Antigravity',
          targetType: 'CONTENT',
          capability: 'PERCEPTION',
          contentSnapshot: '1. Phase 1: TurnEnvelope. 2. Phase 2: AuthoritativeInteractionContext. 3. Phase 3: CapabilityDispatcher.',
          contentItems: [
            'Phase 1: TurnEnvelope',
            'Phase 2: AuthoritativeInteractionContext',
            'Phase 3: CapabilityDispatcher',
          ],
        },
        outputText: 'The window contains three items: 1. Phase 1, 2. Phase 2, 3. Phase 3.',
      });

      const res1 = await capabilityDispatcher.executePlan(env1);
      expect(res1.completedSuccessfully).toBe(true);

      const ctxAfterTurn1 = authoritativeInteractionContext.getContext(CONV_CONTENT);
      expect(ctxAfterTurn1.activeContentItems.length).toBe(3);

      // Turn 2: "Read point two."
      const env2 = createTurnEnvelope({
        conversationId: CONV_CONTENT,
        source: 'voice_livekit',
        rawText: 'Read point two',
      });

      expect(env2.compiledIntent.action).toBe('READ_CONTENT');
      expect(env2.compiledIntent.ordinal).toBe(2);

      // Ensure AppCapabilityAdapter is NOT called with "point two"
      const appSpy = vi.spyOn(appCapabilityAdapter, 'execute');

      const res2 = await capabilityDispatcher.executePlan(env2);

      expect(res2.completedSuccessfully).toBe(true);
      expect(appSpy).not.toHaveBeenCalled();
      expect(res2.responseText).toContain('Phase 2: AuthoritativeInteractionContext');
      expect(getLegacyExecutionEscapeCount()).toBe(0);
    });
  });

  describe('Scenario D: Camera Context Switch', () => {
    const CONV_CAM = 'conv-cam-test';

    it('Camera handles Turns 1-2; Turn 3 switches to Chrome and camera receives no execution request', async () => {
      // Turn 1: CAMERA_OBSERVE
      const camStep: CompiledTurnIntent = {
        action: 'CAMERA_OBSERVE' as any,
        targetType: 'CAMERA' as any,
        application: null,
        target: 'camera',
        contentRequest: 'What am I holding?',
        ordinal: null,
        count: null,
        worker: null,
        delegationRequested: false,
        confidence: 1.0,
        isDirectCommand: true,
        rawPrompt: 'Look at what I am holding',
        normalizedPrompt: 'look at what i am holding',
        reason: 'Camera observation directive',
      };

      const env1 = {
        turnId: 'turn-cam-1',
        conversationId: CONV_CAM,
        source: 'voice_livekit' as const,
        rawText: 'Look at what I am holding',
        normalizedText: 'look at what i am holding',
        timestamp: new Date().toISOString(),
        compiledIntent: camStep,
        compiledPlan: [camStep],
        interactionContextId: CONV_CAM,
      };

      const camSpy = vi.spyOn(perceptionCapabilityAdapter, 'observeCamera').mockResolvedValue({
        stepId: 'cam-step',
        action: 'CAMERA_OBSERVE',
        requestedTarget: 'camera',
        executedTarget: 'camera',
        success: true,
        verified: true,
        contextMutation: {
          capability: 'CAMERA',
          targetType: 'CAMERA',
          contentSnapshot: 'You are holding a blue cup.',
        },
        outputText: 'You are holding a blue cup.',
      });

      // Execute turn 1
      await capabilityDispatcher.executePlan(env1);

      let ctx = authoritativeInteractionContext.getContext(CONV_CAM);
      expect(ctx.activeCapability).toBe('CAMERA');
      expect(camSpy).toHaveBeenCalledTimes(1);

      // Turn 3: "Open Chrome"
      const env3 = createTurnEnvelope({
        conversationId: CONV_CAM,
        source: 'voice_livekit',
        rawText: 'Open Chrome',
      });

      expect(env3.compiledIntent.action).toBe('OPEN_APPLICATION');
      expect(env3.compiledIntent.application).toBe('Chrome');

      vi.spyOn(appCapabilityAdapter, 'execute').mockResolvedValueOnce({
        stepId: 'app-step',
        action: 'OPEN_APPLICATION',
        requestedTarget: 'Chrome',
        executedTarget: 'Chrome',
        success: true,
        verified: true,
        contextMutation: {
          application: 'Chrome',
          capability: 'APPLICATION',
          targetType: 'APPLICATION',
        },
        outputText: 'I have opened Chrome.',
      });

      camSpy.mockClear();

      const res3 = await capabilityDispatcher.executePlan(env3);

      expect(res3.completedSuccessfully).toBe(true);
      // Hard Invariant: Camera receives NO execution request for turn 3
      expect(camSpy).not.toHaveBeenCalled();

      ctx = authoritativeInteractionContext.getContext(CONV_CAM);
      expect(ctx.activeApplication).toBe('Chrome');
      expect(ctx.activeCapability).toBe('APPLICATION');
      expect(getLegacyExecutionEscapeCount()).toBe(0);
    });
  });

  describe('Scenario E: Delegation Isolation', () => {
    const CONV_DEL = 'conv-delegation-test';

    it('E.1: "Read Antigravity" routes to perception adapter, NEVER to delegation adapter', async () => {
      const env1 = createTurnEnvelope({
        conversationId: CONV_DEL,
        source: 'typed_http',
        rawText: 'Read what is inside Antigravity',
      });

      const delSpy = vi.spyOn(delegationCapabilityAdapter, 'execute');
      const percSpy = vi.spyOn(perceptionCapabilityAdapter, 'execute').mockResolvedValueOnce({
        stepId: 's1',
        action: 'READ_CONTENT',
        requestedTarget: 'Antigravity',
        executedTarget: 'Antigravity',
        success: true,
        verified: true,
        outputText: 'Window text content',
      });

      await capabilityDispatcher.executePlan(env1);

      expect(percSpy).toHaveBeenCalledTimes(1);
      expect(delSpy).not.toHaveBeenCalled();
      expect(getLegacyExecutionEscapeCount()).toBe(0);
    });

    it('E.2: "Delegate this problem to Antigravity" routes to delegation adapter and creates background task', async () => {
      const env2 = createTurnEnvelope({
        conversationId: CONV_DEL + '-2',
        source: 'typed_http',
        rawText: 'Delegate this problem to Antigravity',
      });

      expect(env2.compiledIntent.action).toBe('DELEGATE');
      expect(env2.compiledIntent.worker).toBe('antigravity');
      expect(env2.compiledIntent.delegationRequested).toBe(true);

      const percSpy = vi.spyOn(perceptionCapabilityAdapter, 'execute');
      const delSpy = vi.spyOn(delegationCapabilityAdapter, 'execute').mockResolvedValueOnce({
        stepId: 'del-step',
        action: 'DELEGATE',
        requestedTarget: 'antigravity',
        executedTarget: 'antigravity',
        success: true,
        verified: true,
        verificationEvidence: {
          source: 'task_registry',
          label: 'Task bgtask-777 assigned to antigravity',
          observedAt: Date.now(),
          data: { taskId: 'bgtask-777' },
        },
        contextMutation: {
          worker: 'antigravity',
          taskId: 'bgtask-777',
          targetType: 'WORKER',
          capability: 'DELEGATION',
        },
        outputText: 'I have delegated this task to Antigravity.',
      });

      const res = await capabilityDispatcher.executePlan(env2);

      expect(delSpy).toHaveBeenCalledTimes(1);
      expect(percSpy).not.toHaveBeenCalled();
      expect(res.completedSuccessfully).toBe(true);

      const ctx = authoritativeInteractionContext.getContext(CONV_DEL + '-2');
      expect(ctx.activeWorker).toBe('antigravity');
      expect(ctx.activeTaskId).toBe('bgtask-777');
      expect(getLegacyExecutionEscapeCount()).toBe(0);
    });
  });

  describe('Scenario F: Compound 3-Step Failure Barrier', () => {
    const CONV_3STEP = 'conv-3step-test';

    it('Plan contains 3 steps; Step 2 fails verification -> Step 3 never executes', async () => {
      // Synthesize a 3-step compiled plan
      const step1: CompiledTurnIntent = {
        action: 'OPEN_APPLICATION',
        targetType: 'APPLICATION_WINDOW',
        application: 'Telegram',
        target: 'Telegram',
        contentRequest: null,
        ordinal: null,
        count: null,
        worker: null,
        delegationRequested: false,
        confidence: 1.0,
        isDirectCommand: true,
        rawPrompt: 'Open Telegram',
        normalizedPrompt: 'open telegram',
        reason: 'Step 1',
      };

      const step2: CompiledTurnIntent = {
        action: 'OPEN_CHAT',
        targetType: 'CHAT_CONVERSATION',
        application: 'Telegram',
        target: 'Agentic OS bot',
        contentRequest: null,
        ordinal: null,
        count: null,
        worker: null,
        delegationRequested: false,
        confidence: 1.0,
        isDirectCommand: true,
        rawPrompt: 'Open Agentic OS bot',
        normalizedPrompt: 'open agentic os bot',
        reason: 'Step 2',
      };

      const step3: CompiledTurnIntent = {
        action: 'READ_MESSAGES',
        targetType: 'CHAT_CONVERSATION',
        application: 'Telegram',
        target: 'Agentic OS bot',
        contentRequest: null,
        ordinal: null,
        count: 2,
        worker: null,
        delegationRequested: false,
        confidence: 1.0,
        isDirectCommand: true,
        rawPrompt: 'Read the last 2 messages',
        normalizedPrompt: 'read last 2 messages',
        reason: 'Step 3',
      };

      // TurnEnvelope with 3 steps
      const envelope = {
        turnId: 'turn-3step-fail',
        conversationId: CONV_3STEP,
        source: 'typed_http' as const,
        rawText: 'compound 3-step test',
        normalizedText: 'compound 3-step test',
        timestamp: new Date().toISOString(),
        compiledIntent: step1,
        compiledPlan: [step1, step2, step3],
        interactionContextId: CONV_3STEP,
      };

      // Step 1 verifies
      vi.spyOn(appCapabilityAdapter, 'execute').mockResolvedValueOnce({
        stepId: 'step-0',
        action: 'OPEN_APPLICATION',
        requestedTarget: 'Telegram',
        executedTarget: 'Telegram',
        success: true,
        verified: true,
        contextMutation: {
          application: 'Telegram',
          targetType: 'APPLICATION',
        },
      });

      // Step 2 fails verification
      vi.spyOn(chatCapabilityAdapter, 'execute').mockResolvedValueOnce({
        stepId: 'step-1',
        action: 'OPEN_CHAT',
        requestedTarget: 'Agentic OS bot',
        executedTarget: null,
        success: false,
        verified: false,
        failureReason: 'Telegram is open, but I could not locate and verify the Agentic OS bot conversation.',
      });

      // Step 3 spy
      const readSpy = vi.spyOn(chatCapabilityAdapter, 'readMessages');

      const res = await capabilityDispatcher.executePlan(envelope);

      expect(res.completedSuccessfully).toBe(false);
      expect(res.verifiedSteps.length).toBe(1); // Only step 1
      expect(res.failedStep?.stepIndex).toBe(1); // Step 2 failed

      // Step 3 was NEVER called
      expect(readSpy).not.toHaveBeenCalled();

      // Context represents only verified state through step 1
      const ctx = authoritativeInteractionContext.getContext(CONV_3STEP);
      expect(ctx.activeApplication).toBe('Telegram');
      expect(ctx.activeChat).toBeNull();
      expect(ctx.verifiedSelectedChat).toBe(false);
      expect(ctx.planStatus).toBe('PARTIALLY_COMPLETED');
      expect(getLegacyExecutionEscapeCount()).toBe(0);
    });
  });
});
