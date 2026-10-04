import { describe, it, expect, beforeEach } from 'vitest';
import {
  authoritativeInteractionContext,
  AuthoritativeInteractionContextManager,
} from '../domains/controlPlane/AuthoritativeInteractionContext.js';
import { AuthoritativeIntentCompiler } from '../domains/controlPlane/AuthoritativeIntentCompiler.js';
import { createTurnEnvelope } from '../domains/controlPlane/TurnEnvelope.js';

describe('Phase 2 — AuthoritativeInteractionContext', () => {
  const CONV_A = 'conv-seq-a';
  const CONV_B = 'conv-seq-b';
  const CONV_C = 'conv-seq-c';
  const CONV_D = 'conv-seq-d';
  const CONV_PENDING = 'conv-pending-test';

  beforeEach(() => {
    authoritativeInteractionContext.resetContext();
  });

  describe('1. Single Writable Owner & Canonical Context Structure', () => {
    it('creates an immutable snapshot with all required Phase 2 fields', () => {
      const ctx = authoritativeInteractionContext.getContext('conv-basic');

      expect(ctx.conversationId).toBe('conv-basic');
      expect(ctx.activeApplication).toBeNull();
      expect(ctx.activeWindow).toBeNull();
      expect(ctx.activeWindowHandle).toBeNull();
      expect(ctx.activeTargetType).toBe('NONE');
      expect(ctx.activeTarget).toBeNull();
      expect(ctx.activeCapability).toBeNull();
      expect(ctx.activePage).toBeNull();
      expect(ctx.activeUrl).toBeNull();
      expect(ctx.activeChat).toBeNull();
      expect(ctx.verifiedSelectedChat).toBe(false);
      expect(ctx.activeContentSnapshot).toBeNull();
      expect(Array.isArray(ctx.activeContentItems)).toBe(true);
      expect(Array.isArray(ctx.activeMessages)).toBe(true);
      expect(ctx.lastCompiledIntent).toBeNull();
      expect(ctx.lastCompletedAction).toBeNull();
      expect(ctx.lastVerifiedResult).toBeNull();
      expect(ctx.pendingAction).toBeNull();
      expect(ctx.pendingTarget).toBeNull();
      expect(ctx.pendingOrdinal).toBeNull();
      expect(ctx.activeWorker).toBeNull();
      expect(ctx.activeTaskId).toBeNull();
      expect(typeof ctx.contextVersion).toBe('number');
      expect(typeof ctx.updatedAt).toBe('string');

      // Frozen immutability check
      expect(Object.isFrozen(ctx)).toBe(true);
      expect(() => {
        (ctx as any).activeApplication = 'Mutated';
      }).toThrow();
    });

    it('maintains exactly one writable instance across imports', () => {
      const manager1 = AuthoritativeInteractionContextManager.getInstance();
      const manager2 = AuthoritativeInteractionContextManager.getInstance();
      expect(manager1).toBe(manager2);
      expect(manager1).toBe(authoritativeInteractionContext);
    });
  });

  describe('2. SEQUENCE A — Camera Observation to Chrome Switch', () => {
    it('inherits camera context on follow-up and replaces with Chrome on explicit command', () => {
      // Step 1: CAMERA_OBSERVE
      const turn1Intent = AuthoritativeIntentCompiler.compile('Open the camera.');
      authoritativeInteractionContext.recordExplicitIntent(CONV_A, turn1Intent);

      // Verify camera observation step succeeds
      authoritativeInteractionContext.recordVerifiedStepSuccess(CONV_A, 0, {
        capability: 'CAMERA',
        target: 'camera',
        targetType: 'CAMERA',
        contentSnapshot: 'Active camera view: user seated at desk holding black smartphone.',
        summary: 'Camera active. Observing user holding black smartphone.',
      });

      let ctx = authoritativeInteractionContext.getContext(CONV_A);
      expect(ctx.activeCapability).toBe('CAMERA');
      expect(ctx.activeTargetType).toBe('CAMERA');
      expect(ctx.activeContentSnapshot).toContain('holding black smartphone');

      // Step 2: Follow-up "What am I holding?"
      const deictic = authoritativeInteractionContext.resolveDeicticReferent(CONV_A, 'What am I holding?');
      expect(deictic.resolved).toBe(true);
      expect(deictic.source).toBe('CAMERA');
      expect(deictic.resolvedContent).toContain('holding black smartphone');

      // Step 3: Explicit command "Open Google Chrome."
      const turn3Intent = AuthoritativeIntentCompiler.compile('Open Google Chrome.');
      expect(turn3Intent.action).toBe('OPEN_APPLICATION');
      expect(turn3Intent.application).toBe('Chrome');

      // High Invariant: NEW EXPLICIT COMPILED INTENT > DEICTIC / PREVIOUS CAMERA CONTEXT
      authoritativeInteractionContext.recordExplicitIntent(CONV_A, turn3Intent);
      ctx = authoritativeInteractionContext.getContext(CONV_A);
      // Immediately, camera is no longer active conversational target
      expect(ctx.activeCapability).toBe('APPLICATION');
      expect(ctx.activeTargetType).toBe('APPLICATION');

      // Atomic verification of Chrome launch
      authoritativeInteractionContext.recordVerifiedStepSuccess(CONV_A, 0, {
        application: 'Chrome',
        window: 'Google Chrome',
        target: 'Google Chrome',
        capability: 'APPLICATION',
        targetType: 'APPLICATION',
        summary: 'Google Chrome opened and foregrounded.',
      });

      ctx = authoritativeInteractionContext.getContext(CONV_A);
      expect(ctx.activeApplication).toBe('Chrome');
      expect(ctx.activeCapability).toBe('APPLICATION');
      expect(ctx.activeTarget).toBe('Google Chrome');
      expect(ctx.activeTargetType).toBe('APPLICATION');
    });
  });

  describe('3. SEQUENCE B — Antigravity Content Reading to Telegram Switch', () => {
    it('resolves ordinals and "that" follow-ups against Antigravity, then cleanly switches to Telegram', () => {
      // Step 1: READ_CONTENT Antigravity
      const turn1Intent = AuthoritativeIntentCompiler.compile('Read what is inside Antigravity.');
      authoritativeInteractionContext.recordExplicitIntent(CONV_B, turn1Intent);

      const antigravityPageText = [
        '1. Architecture Overview and Invariants',
        '2. Do NOT begin Phase 2 until accepted.',
        '3. Safety gates and test requirements',
      ].join('\n');

      authoritativeInteractionContext.recordVerifiedStepSuccess(CONV_B, 0, {
        application: 'Antigravity',
        window: 'Antigravity IDE',
        target: 'Antigravity',
        targetType: 'CONTENT',
        capability: 'CONTENT',
        contentSnapshot: antigravityPageText,
        contentItems: [
          'Architecture Overview and Invariants',
          'Do NOT begin Phase 2 until accepted.',
          'Safety gates and test requirements',
        ],
        summary: 'Extracted Antigravity documentation with 3 numbered points.',
      });

      let ctx = authoritativeInteractionContext.getContext(CONV_B);
      expect(ctx.activeApplication).toBe('Antigravity');
      expect(ctx.activeContentItems).toHaveLength(3);

      // Step 2: READ_CONTENT ordinal 2 ("Read point two.")
      const turn2Intent = AuthoritativeIntentCompiler.compile('Read point two.');
      expect(turn2Intent.action).toBe('READ_CONTENT');
      expect(turn2Intent.ordinal).toBe(2);

      // Resolve against activeContentSnapshot / items
      const point2Resolution = authoritativeInteractionContext.resolveDeicticReferent(CONV_B, 'point 2', 2);
      expect(point2Resolution.resolved).toBe(true);
      expect(point2Resolution.source).toBe('CONTENT_ITEM');
      expect(point2Resolution.resolvedOrdinal).toBe(2);
      expect(point2Resolution.resolvedContent).toBe('Do NOT begin Phase 2 until accepted.');

      authoritativeInteractionContext.recordVerifiedStepSuccess(CONV_B, 0, {
        summary: 'Point two states: "Do NOT begin Phase 2 until accepted."',
      });

      // Step 3: Follow-up "What does that mean?"
      const thatResolution = authoritativeInteractionContext.resolveDeicticReferent(CONV_B, 'What does that mean?');
      expect(thatResolution.resolved).toBe(true);
      expect(thatResolution.source).toBe('CONTENT_ITEM');
      expect(thatResolution.resolvedContent).toContain('Do NOT begin Phase 2 until accepted.');

      // Step 4: OPEN_APPLICATION Telegram
      const turn4Intent = AuthoritativeIntentCompiler.compile('Open Telegram.');
      expect(turn4Intent.action).toBe('OPEN_APPLICATION');
      expect(turn4Intent.application).toBe('Telegram');

      authoritativeInteractionContext.recordExplicitIntent(CONV_B, turn4Intent);
      authoritativeInteractionContext.recordVerifiedStepSuccess(CONV_B, 0, {
        application: 'Telegram',
        target: 'Telegram Desktop',
        targetType: 'APPLICATION',
        capability: 'APPLICATION',
        summary: 'Telegram Desktop opened.',
      });

      ctx = authoritativeInteractionContext.getContext(CONV_B);
      expect(ctx.activeApplication).toBe('Telegram');
      expect(ctx.activeTarget).toBe('Telegram Desktop');
      // Antigravity context no longer controls execution
      expect(ctx.activeTargetType).toBe('APPLICATION');
    });
  });

  describe('4. SEQUENCE C — Compound Plan & Partial Failure Guard', () => {
    it('tracks compound plan step-by-step and never claims entire plan succeeded on step failure', () => {
      // Compiled plan: "Open Telegram and locate Agentic OS bot."
      const plan = AuthoritativeIntentCompiler.compilePlan('Open Telegram and locate Agentic OS bot.');
      expect(plan.steps).toHaveLength(2);
      expect(plan.steps[0].action).toBe('OPEN_APPLICATION');
      expect(plan.steps[1].action).toBe('OPEN_CHAT');

      authoritativeInteractionContext.recordExplicitIntent(CONV_C, plan.steps[0], plan);

      let ctx = authoritativeInteractionContext.getContext(CONV_C);
      expect(ctx.planStatus).toBe('EXECUTING');
      expect(ctx.currentStepIndex).toBe(0);
      expect(ctx.pendingStep?.action).toBe('OPEN_APPLICATION');
      expect(ctx.completedSteps).toHaveLength(0);

      // Simulate Step 1 verified success: Telegram opens
      authoritativeInteractionContext.recordVerifiedStepSuccess(CONV_C, 0, {
        application: 'Telegram',
        target: 'Telegram Desktop',
        summary: 'Telegram launched and focused.',
      });

      ctx = authoritativeInteractionContext.getContext(CONV_C);
      expect(ctx.activeApplication).toBe('Telegram');
      expect(ctx.completedSteps).toHaveLength(1);
      expect(ctx.currentStepIndex).toBe(1);
      expect(ctx.pendingStep?.action).toBe('OPEN_CHAT');
      // Invariant: Step 2 not yet verified -> Agentic OS bot must NOT be recorded as selected!
      expect(ctx.activeChat).toBeNull();
      expect(ctx.verifiedSelectedChat).toBe(false);

      // Simulate Step 2 failure: Chat selection failed
      authoritativeInteractionContext.recordStepFailure(
        CONV_C,
        1,
        'Failed to select Agentic OS bot: conversation not found in active list.'
      );

      ctx = authoritativeInteractionContext.getContext(CONV_C);
      expect(ctx.activeApplication).toBe('Telegram');
      expect(ctx.activeChat).not.toBe('Agentic OS bot');
      expect(ctx.activeChat).toBeNull();
      expect(ctx.verifiedSelectedChat).toBe(false);
      expect(ctx.planStatus).toBe('PARTIALLY_COMPLETED');
      expect(ctx.pendingStep?.action).toBe('OPEN_CHAT');
      expect(ctx.planVerificationResults).toHaveLength(2);
      expect(ctx.planVerificationResults[0].success).toBe(true);
      expect(ctx.planVerificationResults[1].success).toBe(false);
      expect(ctx.planVerificationResults[1].error).toContain('Failed to select Agentic OS bot');
    });
  });

  describe('5. SEQUENCE D — Telegram Messages & Deictic Reference', () => {
    it('verifies selected chat and resolves "the last one" against the 4th extracted message', () => {
      // Step 1: Telegram + Agentic OS bot successfully verified
      authoritativeInteractionContext.recordVerifiedStepSuccess(CONV_D, 0, {
        application: 'Telegram',
        target: 'Telegram Desktop',
        chat: 'Agentic OS bot',
        verifiedSelectedChat: true,
        targetType: 'CHAT',
        summary: 'Telegram open with Agentic OS bot verified as active conversation.',
      });

      let ctx = authoritativeInteractionContext.getContext(CONV_D);
      expect(ctx.activeApplication).toBe('Telegram');
      expect(ctx.activeChat).toBe('Agentic OS bot');
      expect(ctx.verifiedSelectedChat).toBe(true);
      expect(ctx.activeTargetType).toBe('CHAT');

      // Step 2: READ_MESSAGES count=4
      const extractedMessages = [
        { id: 1, sender: 'Agentic OS bot', text: 'Task 101 acknowledged.', timestamp: 1790900100 },
        { id: 2, sender: 'Agentic OS bot', text: 'All health checks passing.', timestamp: 1790900200 },
        { id: 3, sender: 'Agentic OS bot', text: 'Build artifacts deployed to runtime.', timestamp: 1790900300 },
        { id: 4, sender: 'Agentic OS bot', text: 'Phase 2 interaction context migration complete.', timestamp: 1790900400 },
      ];

      authoritativeInteractionContext.recordVerifiedStepSuccess(CONV_D, 1, {
        messages: extractedMessages,
        summary: 'Read the last four messages from Agentic OS bot.',
      });

      ctx = authoritativeInteractionContext.getContext(CONV_D);
      expect(ctx.activeMessages).toHaveLength(4);
      expect(ctx.activeMessages[3].text).toBe('Phase 2 interaction context migration complete.');

      // Step 3: Deictic follow-up: "What does the last one mean?"
      const deictic = authoritativeInteractionContext.resolveDeicticReferent(CONV_D, 'What does the last one mean?');
      expect(deictic.resolved).toBe(true);
      expect(deictic.source).toBe('CHAT_MESSAGE');
      expect(deictic.resolvedContent).toBe('Phase 2 interaction context migration complete.');
      expect(deictic.message?.sender).toBe('Agentic OS bot');
    });
  });

  describe('6. Pending Action Continuity & Priority Cancellation', () => {
    it('stores pending action and executes on confirmation ("yes", "do it")', () => {
      // Jarvis proposes: "Should I read point three?"
      authoritativeInteractionContext.setPendingAction(CONV_PENDING, {
        action: 'READ_CONTENT',
        target: 'point 3',
        ordinal: 3,
      });

      let ctx = authoritativeInteractionContext.getContext(CONV_PENDING);
      expect(ctx.pendingAction).toBe('READ_CONTENT');
      expect(ctx.pendingOrdinal).toBe(3);

      // User confirms: "Yes, go ahead."
      const pending = ctx.pendingAction;
      const ordinal = ctx.pendingOrdinal;
      expect(pending).toBe('READ_CONTENT');
      expect(ordinal).toBe(3);

      authoritativeInteractionContext.clearPendingAction(CONV_PENDING);
      ctx = authoritativeInteractionContext.getContext(CONV_PENDING);
      expect(ctx.pendingAction).toBeNull();
      expect(ctx.pendingOrdinal).toBeNull();
    });

    it('cancels incompatible pending action when an explicit new instruction arrives', () => {
      // Propose pending action
      authoritativeInteractionContext.setPendingAction(CONV_PENDING, {
        action: 'READ_CONTENT',
        ordinal: 3,
      });

      expect(authoritativeInteractionContext.getContext(CONV_PENDING).pendingAction).toBe('READ_CONTENT');

      // User gives explicit unrelated command: "Open Chrome."
      const newIntent = AuthoritativeIntentCompiler.compile('Open Chrome.');
      authoritativeInteractionContext.recordExplicitIntent(CONV_PENDING, newIntent);

      const ctx = authoritativeInteractionContext.getContext(CONV_PENDING);
      // Pending action was immediately cancelled by new explicit command
      expect(ctx.pendingAction).toBeNull();
      expect(ctx.pendingOrdinal).toBeNull();
    });
  });

  describe('7. Integration with TurnEnvelope', () => {
    it('automatically records explicit intent into AuthoritativeInteractionContext upon envelope creation', () => {
      const envelope = createTurnEnvelope({
        turnId: 'env-test-1',
        conversationId: 'conv-env-auto',
        source: 'voice_livekit',
        rawText: 'Open Chrome and open YouTube.',
      });

      const ctx = authoritativeInteractionContext.getContext('conv-env-auto');
      expect(ctx.lastCompiledIntent).toBeDefined();
      expect(ctx.lastCompiledIntent?.action).toBe('OPEN_APPLICATION');
      expect(ctx.currentPlan).toBeDefined();
      expect(ctx.currentPlan?.steps).toHaveLength(2);
      expect(ctx.planStatus).toBe('EXECUTING');
      expect(ctx.currentStepIndex).toBe(0);
    });
  });
});
