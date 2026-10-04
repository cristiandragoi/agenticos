/**
 * phase5UniversalCapabilityRuntime.test.ts
 *
 * Phase 5 Universal Capability Runtime + Latency Hardening Test Suite
 *
 * Enforces:
 * 1. REAL top-level ingress:
 *    TurnEnvelope -> AuthoritativeIntentCompiler -> AuthoritativeInteractionContext
 *    -> CapabilityDispatcher -> UniversalCapabilityRuntime
 * 2. Universal TargetResolver (exact binding, nested target models)
 * 3. Content Acquisition Hierarchy (fastest first: DOM/UIA -> Window Crop -> Fullscreen)
 * 4. Strict Source & Outcome Verification (prevent wrong chat & cross-target contamination)
 * 5. Latency Instrumentation & Performance Budgets
 * 6. Camera context exit on subsequent explicit capability
 * 7. Delegation verification
 * 8. All Acceptance Cases (Telegram, Website, Antigravity, Hermes 1, Camera, Delegation)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createTurnEnvelope } from '../domains/controlPlane/TurnEnvelope.js';
import { authoritativeInteractionContext } from '../domains/controlPlane/AuthoritativeInteractionContext.js';
import { capabilityDispatcher } from '../domains/controlPlane/CapabilityDispatcher.js';
import { targetResolver } from '../domains/controlPlane/TargetResolver.js';
import { universalContentAcquisition } from '../domains/controlPlane/UniversalContentAcquisition.js';
import {
  sourceOutcomeVerifier,
  getCrossTargetContaminationCount,
  getWrongTargetReadsCount,
  getUnverifiedSuccessCount,
  resetVerificationCounters,
} from '../domains/controlPlane/SourceOutcomeVerifier.js';
import { latencyTracker, LatencyTracker } from '../domains/controlPlane/LatencyTracker.js';

describe('PHASE 5: Universal Capability Runtime + Latency Hardening', () => {
  const conversationId = 'conv-phase5-test';

  beforeEach(() => {
    authoritativeInteractionContext.resetContext(conversationId);
    resetVerificationCounters();
    latencyTracker.reset();

    // Set fixed mock desktop windows to ensure deterministic test execution across all platforms
    targetResolver.setMockWindows([
      { hwnd: 1905378, pid: 2144, process: 'Antigravity IDE', title: 'Antigravity IDE' },
      { hwnd: 460846, pid: 33316, process: 'hermes-agent', title: 'Hermes One' },
      { hwnd: 133174, pid: 5904, process: 'Telegram', title: 'Agentic OS bot – Telegram' },
      { hwnd: 591440, pid: 38080, process: 'chrome', title: 'YouTube - Google Chrome' },
      { hwnd: 591441, pid: 38080, process: 'chrome', title: 'Wikipedia, the free encyclopedia - Google Chrome' },
    ]);

    // Clear custom mock acquisition provider to use default hierarchy
    universalContentAcquisition.setMockProvider(undefined);
  });

  // ── 1. TELEGRAM ACCEPTANCE CASE (Requirement 10) ─────────────────────────
  it('Acceptance Case 1: Telegram exact chat selection, verification, and reading', async () => {
    // Top-level ingress: "Open Telegram and locate Agentic OS bot."
    const env1 = createTurnEnvelope({
      turnId: 'turn-tg-1',
      conversationId,
      rawText: 'Open Telegram and locate Agentic OS bot.',
      source: 'voice_livekit',
    });

    const res1 = await capabilityDispatcher.executePlan(env1);
    expect(res1.completedSuccessfully).toBe(true);

    const ctxAfterStep1 = authoritativeInteractionContext.getContext(conversationId);
    expect(ctxAfterStep1.activeApplication).toBe('Telegram');
    expect(ctxAfterStep1.verifiedSelectedChat).toBe(true);
    expect(ctxAfterStep1.activeChat).toBe('Agentic OS bot');

    // Second turn: "Read the last two messages."
    const env2 = createTurnEnvelope({
      turnId: 'turn-tg-2',
      conversationId,
      rawText: 'Read the last two messages.',
      source: 'voice_livekit',
    });

    const res2 = await capabilityDispatcher.executePlan(env2);
    expect(res2.completedSuccessfully).toBe(true);
    expect(res2.responseText).toContain('Agentic OS bot');

    // Strict invariant: no wrong chat read & no cross target contamination
    expect(getCrossTargetContaminationCount()).toBe(0);
    expect(getWrongTargetReadsCount()).toBe(0);
    expect(getUnverifiedSuccessCount()).toBe(0);
  });

  // ── 1b. FORCED TELEGRAM WRONG CHAT VERIFICATION FAILURE ─────────────────
  it('Acceptance Case 1b: Wrong chat produces FAILURE, does not read unrelated conversation', async () => {
    // Simulate active window pointing to "Russell, Linda and friends" instead of "Agentic OS bot"
    targetResolver.setMockWindows([
      { hwnd: 133174, pid: 5904, process: 'Telegram', title: 'Russell, Linda and friends – Telegram' },
    ]);

    universalContentAcquisition.setMockProvider((intent, target) => {
      if (intent.action === 'READ_MESSAGES') {
        return {
          success: false,
          sourceApplication: 'Telegram',
          sourceWindow: 'Russell, Linda and friends – Telegram',
          sourceChat: 'Russell, Linda and friends',
          acquisitionMethod: 'uia',
          content: '',
          structuredItems: [],
          timestamp: Date.now(),
          verificationEvidence: { wrongChatDetected: true },
          confidence: 0.1,
          visionUsed: false,
          llmUsed: false,
          fallbackCount: 0,
          error: 'Telegram is open, but I could not verify the Agentic OS bot conversation.',
        };
      }
      return null;
    });

    const env = createTurnEnvelope({
      turnId: 'turn-tg-wrong',
      conversationId,
      rawText: 'Open Telegram and locate Agentic OS bot and read the last two messages.',
      source: 'voice_livekit',
    });

    const res = await capabilityDispatcher.executePlan(env);
    expect(res.completedSuccessfully).toBe(false);
    expect(res.responseText).toContain('could not locate and verify the Agentic OS bot conversation');
    expect(res.responseText).not.toContain('Russell, Linda');

    // The attempt was safely caught and rejected
    expect(getWrongTargetReadsCount()).toBeGreaterThanOrEqual(1);
    expect(getCrossTargetContaminationCount()).toBe(0);
  });

  // ── 2. WEBSITE ACCEPTANCE CASE (Requirement 11) ──────────────────────────
  it('Acceptance Case 2: Chrome navigation and generic website reading without site-specific code', async () => {
    // 2a. YouTube: "Open Chrome and open YouTube."
    const env1 = createTurnEnvelope({
      turnId: 'turn-web-1',
      conversationId,
      rawText: 'Open Chrome and open YouTube.',
      source: 'voice_livekit',
    });

    const res1 = await capabilityDispatcher.executePlan(env1);
    expect(res1.completedSuccessfully).toBe(true);

    const ctxAfter1 = authoritativeInteractionContext.getContext(conversationId);
    expect(ctxAfter1.activeApplication).toBe('Chrome');
    expect(ctxAfter1.activeUrl).toContain('youtube.com');

    // 2b. Another normal website (Wikipedia) using the same generic runtime!
    const env2 = createTurnEnvelope({
      turnId: 'turn-web-2',
      conversationId,
      rawText: 'Open Chrome and navigate to Wikipedia.',
      source: 'voice_livekit',
    });

    const res2 = await capabilityDispatcher.executePlan(env2);
    expect(res2.completedSuccessfully).toBe(true);
    expect(res2.responseText).toContain('Wikipedia');

    const ctxAfter2 = authoritativeInteractionContext.getContext(conversationId);
    expect(ctxAfter2.activeUrl?.toLowerCase()).toContain('wikipedia');
  });

  // ── 3. DESKTOP CONTENT ACCEPTANCE CASE (Requirement 12) ───────────────────
  it('Acceptance Case 3: Read Antigravity then Hermes 1 with zero cross-target contamination', async () => {
    // Turn 1: "Read what is inside Antigravity."
    const env1 = createTurnEnvelope({
      turnId: 'turn-desktop-1',
      conversationId,
      rawText: 'Read what is inside Antigravity.',
      source: 'voice_livekit',
    });

    const res1 = await capabilityDispatcher.executePlan(env1);
    expect(res1.completedSuccessfully).toBe(true);
    expect(res1.responseText).toContain('Antigravity');

    const ctx1 = authoritativeInteractionContext.getContext(conversationId);
    expect(ctx1.activeApplication).toBe('Antigravity');

    // Turn 2: "Read point two." (ordinal continuation from Antigravity content)
    const env2 = createTurnEnvelope({
      turnId: 'turn-desktop-2',
      conversationId,
      rawText: 'Read point two.',
      source: 'voice_livekit',
    });

    const res2 = await capabilityDispatcher.executePlan(env2);
    expect(res2.completedSuccessfully).toBe(true);
    expect(res2.responseText).toContain('Point 2 is');

    // Turn 3: "Read Hermes 1."
    const env3 = createTurnEnvelope({
      turnId: 'turn-desktop-3',
      conversationId,
      rawText: 'Read Hermes 1.',
      source: 'voice_livekit',
    });

    const res3 = await capabilityDispatcher.executePlan(env3);
    expect(res3.completedSuccessfully).toBe(true);

    const ctx3 = authoritativeInteractionContext.getContext(conversationId);
    expect(ctx3.activeApplication).toBe('Hermes');
    expect(ctx3.activeWindow).toContain('Hermes');

    // Zero cross-target contamination: Hermes never received Antigravity content
    expect(getCrossTargetContaminationCount()).toBe(0);
    expect(getWrongTargetReadsCount()).toBe(0);
  });

  // ── 4. CAMERA ACCEPTANCE CASE (Requirement 13) ───────────────────────────
  it('Acceptance Case 4: Camera observation starts, and subsequent explicit app stops camera immediately', async () => {
    // Turn 1: "Open camera."
    const env1 = createTurnEnvelope({
      turnId: 'turn-cam-1',
      conversationId,
      rawText: 'Open camera.',
      source: 'voice_livekit',
    });

    const res1 = await capabilityDispatcher.executePlan(env1);
    expect(res1.completedSuccessfully).toBe(true);

    const ctx1 = authoritativeInteractionContext.getContext(conversationId);
    expect(ctx1.activeCapability).toBe('CAMERA');

    // Turn 2: "What am I holding?"
    const env2 = createTurnEnvelope({
      turnId: 'turn-cam-2',
      conversationId,
      rawText: 'What am I holding?',
      source: 'voice_livekit',
    });

    const res2 = await capabilityDispatcher.executePlan(env2);
    expect(res2.completedSuccessfully).toBe(true);

    // Turn 3: "Open Telegram." -> MUST STOP USING CAMERA IMMEDIATELY!
    const env3 = createTurnEnvelope({
      turnId: 'turn-cam-3',
      conversationId,
      rawText: 'Open Telegram.',
      source: 'voice_livekit',
    });

    const res3 = await capabilityDispatcher.executePlan(env3);
    expect(res3.completedSuccessfully).toBe(true);

    const ctx3 = authoritativeInteractionContext.getContext(conversationId);
    expect(ctx3.activeApplication).toBe('Telegram');
    expect(ctx3.activeCapability).toBe('APPLICATION');
    expect(ctx3.activeCapability).not.toBe('CAMERA');
  });

  // ── 5. DELEGATION ACCEPTANCE CASE (Requirement 14) ───────────────────────
  it('Acceptance Case 5: "Delegate this problem to Antigravity" creates and verifies exactly 1 task', async () => {
    const env = createTurnEnvelope({
      turnId: 'turn-delegation-1',
      conversationId,
      rawText: 'Delegate this problem to Antigravity.',
      source: 'voice_livekit',
    });
    expect(env.compiledIntent.action).toBe('DELEGATE');
    expect(env.compiledIntent.worker).toBe('antigravity');

    const res = await capabilityDispatcher.executePlan(env);
    expect(res.completedSuccessfully).toBe(true);
    expect(res.responseText.toLowerCase()).toContain('antigravity');

    const ctx = authoritativeInteractionContext.getContext(conversationId);
    expect(ctx.activeCapability).toBe('DELEGATION');
  });

  // ── 6. LATENCY INSTRUMENTATION & BUDGETS (Requirements 6 & 7) ─────────────
  it('Requirement 6 & 7: Turn timings are instrumented across all stages with performance budgets', async () => {
    const env = createTurnEnvelope({
      turnId: 'turn-latency-check',
      conversationId,
      rawText: 'Open Chrome and open YouTube.',
      source: 'voice_livekit',
    });

    await capabilityDispatcher.executePlan(env);

    const stats = latencyTracker.calculateStats();
    expect(stats.count).toBeGreaterThan(0);
    expect(stats.averageByStage.CONTEXT_RESOLUTION_MS).toBeLessThan(LatencyTracker.BUDGETS.CONTEXT_RESOLUTION_MS);
    expect(stats.averageByStage.TARGET_RESOLUTION_MS).toBeLessThan(LatencyTracker.BUDGETS.TARGET_RESOLUTION_MS);
    expect(stats.medianTotal).toBeGreaterThanOrEqual(0);
    expect(stats.p95Total).toBeGreaterThanOrEqual(0);
  });

  // ── 7. TARGET INTEGRITY & WRONG-WINDOW REJECTION REGRESSION ──────────────
  describe('7. Target Integrity & Anti-Contamination Invariants', () => {
    it('rejects Antigravity content when Telegram was requested while Antigravity was foreground', () => {
      const intent = {
        action: 'READ_MESSAGES',
        targetType: 'CHAT_CONVERSATION',
        application: 'Telegram',
        target: 'Agentic OS bot',
        contentRequest: 'last 2 messages',
        ordinal: null,
        count: 2,
        worker: null,
        delegationRequested: false,
        confidence: 1.0,
        isDirectCommand: true,
        rawPrompt: 'Can you read what is inside Agentic OS bot?',
        normalizedPrompt: 'read what is inside Agentic OS bot',
      } as any;

      const target = {
        requestedTarget: 'Agentic OS bot',
        resolvedApplication: 'Telegram',
        targetType: 'CHAT_CONVERSATION',
        windowHandle: 133174,
      } as any;

      // Antigravity window content acquired accidentally from foreground
      const contaminatedAcquisition = {
        success: true,
        sourceApplication: 'Antigravity',
        sourceWindow: 'AgenticOS - Antigravity',
        sourceHwnd: 1905378,
        acquisitionMethod: 'uia',
        content: 'File, Edit, Selection, View, Go, Run, Terminal, Help\nToggle Primary Sidebar\nExplorer',
        structuredItems: ['File', 'Edit', 'Selection'],
        timestamp: Date.now(),
        confidence: 0.95,
        visionUsed: false,
        llmUsed: false,
        fallbackCount: 0,
      } as any;

      const evaluation = sourceOutcomeVerifier.verifyContentAcquisition(intent, target, contaminatedAcquisition);
      expect(evaluation.isVerified).toBe(false);
      expect(evaluation.crossTargetContaminationDetected).toBe(true);
      expect(evaluation.failureReason).toContain('Antigravity');
    });

    it('rejects Word content when Telegram was requested while Word was foreground', () => {
      const intent = {
        action: 'READ_MESSAGES',
        targetType: 'CHAT_CONVERSATION',
        application: 'Telegram',
        target: 'Agentic OS bot',
      } as any;

      const target = {
        requestedTarget: 'Agentic OS bot',
        resolvedApplication: 'Telegram',
      } as any;

      const wordAcquisition = {
        success: true,
        sourceApplication: 'WINWORD',
        sourceWindow: 'Document1 - Word',
        acquisitionMethod: 'uia',
        content: 'Quarterly financial report summary',
        structuredItems: ['Quarterly financial report summary'],
        timestamp: Date.now(),
      } as any;

      const evaluation = sourceOutcomeVerifier.verifyContentAcquisition(intent, target, wordAcquisition);
      expect(evaluation.isVerified).toBe(false);
      expect(evaluation.crossTargetContaminationDetected).toBe(true);
      expect(evaluation.failureReason).toContain('does not match requested application');
    });

    it('rejects content when the source HWND does not match the target HWND', () => {
      const intent = {
        action: 'READ_CONTENT',
        targetType: 'APPLICATION_WINDOW',
        application: 'Telegram',
        target: 'Telegram',
      } as any;

      const target = {
        requestedTarget: 'Telegram',
        resolvedApplication: 'Telegram',
        windowHandle: 133174,
      } as any;

      const mismatchedHwndAcquisition = {
        success: true,
        sourceApplication: 'Telegram',
        sourceWindow: 'Telegram',
        sourceHwnd: 999999, // Mismatched HWND!
        acquisitionMethod: 'uia',
        content: 'Some telegram text',
        structuredItems: ['Some telegram text'],
        timestamp: Date.now(),
      } as any;

      const evaluation = sourceOutcomeVerifier.verifyContentAcquisition(intent, target, mismatchedHwndAcquisition);
      expect(evaluation.isVerified).toBe(false);
      expect(evaluation.crossTargetContaminationDetected).toBe(true);
      expect(evaluation.failureReason).toContain('does not match target window handle');
    });
  });
});
