/**
 * phase6bAgentSComputerUse.test.ts — Phase 6B Acceptance & Verification Suite
 *
 * Validates:
 * 1. ComputerUseProvider interface and AgentSComputerUseProvider subordinate boundary.
 * 2. Two-Speed Execution:
 *    - Fast path ("Open Chrome", "Close Telegram") executes deterministically via native Win32/UIA.
 *    - Agent-S is NEVER invoked for fast-path commands.
 * 3. Generic Acceptance Tasks:
 *    - A: Telegram (Locate conversation Agentic OS)
 *    - B: Windows Settings (Navigate to visible settings page)
 *    - C: Antigravity (Locate requested visible panel/control)
 *    - D: Electron / Custom UI (Locate and activate visible target)
 * 4. Verification Authority:
 *    - Agent-S claiming status: 'SUCCESS' is a proposal only.
 *    - If AgenticOS independent verification fails, returns UNVERIFIED / failure.
 *    - Zero unverified completions accepted!
 * 5. Window Contamination Prevention:
 *    - Rejection of "Null client input sync window..." and AgenticOS window chrome.
 * 6. Zero per-app patches added.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  agentSComputerUseProvider,
  computerUseRegistry,
  type ComputerUseGoalRequest,
  type ComputerUseGoalResult,
} from '../domains/controlPlane/computerUse/index.js';
import { universalCapabilityRuntime } from '../domains/controlPlane/UniversalCapabilityRuntime.js';
import { AuthoritativeIntentCompiler } from '../domains/controlPlane/AuthoritativeIntentCompiler.js';
import { authoritativeInteractionContext } from '../domains/controlPlane/AuthoritativeInteractionContext.js';
import { sourceOutcomeVerifier } from '../domains/controlPlane/SourceOutcomeVerifier.js';
import { appCapabilityAdapter } from '../domains/controlPlane/adapters/AppCapabilityAdapter.js';
import { chatCapabilityAdapter } from '../domains/controlPlane/adapters/ChatCapabilityAdapter.js';
import { guiNavigationCapabilityAdapter } from '../domains/controlPlane/adapters/GuiNavigationCapabilityAdapter.js';
import { targetResolver } from '../domains/controlPlane/TargetResolver.js';

describe('Phase 6B — Agent-S3 Computer-Use & Grounding Provider', () => {
  const convId = 'test-phase6b-conv';

  beforeEach(() => {
    authoritativeInteractionContext.resetContext(convId);
    agentSComputerUseProvider.setMockRunner(undefined);
  });

  // ── 1. Provider Boundary & Contract ─────────────────────────────────────
  it('registers Agent-S3 as the subordinate active ComputerUseProvider', async () => {
    const active = computerUseRegistry.getActiveProvider();
    expect(active).toBeDefined();
    expect(active?.id).toBe('agent-s3');
    expect(active?.name).toContain('Agent-S3');
    expect(active?.version).toBe('0.3.0');
    expect(active?.supportedPlatforms).toContain('win32');
  });

  // ── 2. Two-Speed Execution: Fast Path Preserved ─────────────────────────
  it('preserves native fast path: does NOT invoke Agent-S for simple commands', async () => {
    const executeGoalSpy = vi.fn();
    agentSComputerUseProvider.setMockRunner(executeGoalSpy);

    // Mock open windows so Chrome resolve/focus succeeds immediately
    vi.spyOn(targetResolver, 'getOpenWindows').mockResolvedValue([
      { hwnd: 101, title: 'Google Chrome', process: 'chrome.exe' },
    ]);

    const step = AuthoritativeIntentCompiler.compile('Open Chrome.');
    const result = await universalCapabilityRuntime.executeStep(step, 'fast-1', convId);

    expect(result.success).toBe(true);
    expect(result.verified).toBe(true);
    // CRITICAL: Agent-S must NEVER be invoked for simple fast-path operations!
    expect(executeGoalSpy).not.toHaveBeenCalled();
  });

  // ── 3. Task A: Telegram (Locate conversation Agentic OS) ─────────────────
  it('Task A (Telegram): generic computer-use locates chat; verified by AgenticOS', async () => {
    let agentSInvoked = false;

    agentSComputerUseProvider.setMockRunner(async (req: ComputerUseGoalRequest): Promise<ComputerUseGoalResult> => {
      agentSInvoked = true;
      expect(req.application).toBe('Telegram');
      expect(req.target).toBe('Agentic OS');

      // Simulate Agent-S visually observing and clicking chat
      return {
        status: 'SUCCESS',
        observations: [
          { step: 1, windowTitle: 'Telegram', visualTargetFound: true, actionProposed: 'click(210, 185)', timestamp: Date.now() },
        ],
        actions: ['click(210, 185)'],
        claimedTarget: 'Agentic OS',
        evidence: { groundingModel: 'UI-TARS-1.5-7B' },
        durationMs: 420,
        stepCount: 1,
      };
    });

    const step = {
      action: 'OPEN_CHAT' as const,
      targetType: 'CHAT_CONVERSATION' as const,
      application: 'Telegram',
      target: 'Agentic OS',
      contentRequest: null,
      ordinal: null,
      count: null,
      worker: null,
      delegationRequested: false,
      confidence: 1.0,
      isDirectCommand: true,
      rawPrompt: 'Open Telegram and locate Agentic OS',
      normalizedPrompt: 'open telegram and locate agentic os',
      reason: 'Locate Agentic OS in Telegram',
    };

    // Initial state: Telegram is open, but chat is NOT selected
    // Post-Agent-S state: Chat is selected and active in title
    vi.spyOn(targetResolver, 'getOpenWindows')
      .mockResolvedValueOnce([{ hwnd: 201, title: 'Telegram', process: 'telegram.exe' }])
      .mockResolvedValue([{ hwnd: 201, title: 'Agentic OS – Telegram', process: 'telegram.exe' }]);

    const result = await chatCapabilityAdapter.execute(step, 'tg-1', convId);

    expect(agentSInvoked).toBe(true);
    expect(result.success).toBe(true);
    expect(result.verified).toBe(true);
    expect(result.contextMutation?.verifiedSelectedChat).toBe(true);
    expect(result.outputText).toContain('Agentic OS');
  });

  // ── 4. Task B: Windows Settings (Navigate to visible settings page) ───────
  it('Task B (Windows Settings): generic computer-use navigates to System page', async () => {
    let agentSInvoked = false;

    vi.spyOn(targetResolver, 'getOpenWindows').mockResolvedValue([
      { hwnd: 301, title: 'Settings', process: 'SystemSettings.exe' },
    ]);

    agentSComputerUseProvider.setMockRunner(async (req: ComputerUseGoalRequest): Promise<ComputerUseGoalResult> => {
      agentSInvoked = true;
      expect(req.application).toBe('Settings');
      expect(req.target).toBe('System');

      return {
        status: 'SUCCESS',
        observations: [
          { step: 1, windowTitle: 'Settings', visualTargetFound: true, actionProposed: 'click(120, 310)', timestamp: Date.now() },
        ],
        actions: ['click(120, 310)'],
        claimedTarget: 'System',
        evidence: { groundingModel: 'UI-TARS-1.5-7B' },
        durationMs: 310,
        stepCount: 1,
      };
    });

    const step = {
      action: 'NAVIGATE_GUI' as any,
      targetType: 'APPLICATION_WINDOW' as any,
      application: 'Settings',
      target: 'System',
      contentRequest: null,
      ordinal: null,
      count: null,
      worker: null,
      delegationRequested: false,
      confidence: 1.0,
      isDirectCommand: true,
      rawPrompt: 'In Settings, navigate to System page',
      normalizedPrompt: 'in settings navigate to system page',
      reason: 'Navigate to System in Settings',
    };

    const result = await guiNavigationCapabilityAdapter.execute(step, 'settings-1', convId);

    expect(agentSInvoked).toBe(true);
    expect(result.success).toBe(true);
    expect(result.verified).toBe(true);
    expect(result.outputText).toContain('System in Settings');
  });

  // ── 5. Task C: Antigravity (Locate requested visible panel/control) ──────
  it('Task C (Antigravity): generic computer-use locates Terminal panel', async () => {
    let agentSInvoked = false;

    vi.spyOn(targetResolver, 'getOpenWindows').mockResolvedValue([
      { hwnd: 401, title: 'Antigravity IDE', process: 'antigravity.exe' },
    ]);

    agentSComputerUseProvider.setMockRunner(async (req: ComputerUseGoalRequest): Promise<ComputerUseGoalResult> => {
      agentSInvoked = true;
      expect(req.application).toBe('Antigravity');
      expect(req.target).toBe('Terminal Panel');

      return {
        status: 'SUCCESS',
        observations: [
          { step: 1, windowTitle: 'Antigravity IDE', visualTargetFound: true, actionProposed: 'click(540, 890)', timestamp: Date.now() },
        ],
        actions: ['click(540, 890)'],
        claimedTarget: 'Terminal Panel',
        evidence: { groundingModel: 'UI-TARS-1.5-7B' },
        durationMs: 290,
        stepCount: 1,
      };
    });

    const step = {
      action: 'LOCATE_ELEMENT' as any,
      targetType: 'APPLICATION_WINDOW' as any,
      application: 'Antigravity',
      target: 'Terminal Panel',
      contentRequest: null,
      ordinal: null,
      count: null,
      worker: null,
      delegationRequested: false,
      confidence: 1.0,
      isDirectCommand: true,
      rawPrompt: 'In Antigravity, locate Terminal Panel',
      normalizedPrompt: 'in antigravity locate terminal panel',
      reason: 'Locate Terminal Panel in Antigravity',
    };

    const result = await guiNavigationCapabilityAdapter.execute(step, 'antigravity-1', convId);

    expect(agentSInvoked).toBe(true);
    expect(result.success).toBe(true);
    expect(result.verified).toBe(true);
  });

  // ── 6. Task D: Electron / Custom UI (Locate and activate target) ─────────
  it('Task D (Electron UI): generic computer-use activates Submit button', async () => {
    let agentSInvoked = false;

    vi.spyOn(targetResolver, 'getOpenWindows').mockResolvedValue([
      { hwnd: 501, title: 'Custom Desktop Client', process: 'electron.exe' },
    ]);

    agentSComputerUseProvider.setMockRunner(async (req: ComputerUseGoalRequest): Promise<ComputerUseGoalResult> => {
      agentSInvoked = true;
      expect(req.application).toBe('Custom Desktop Client');
      expect(req.target).toBe('Submit Button');

      return {
        status: 'SUCCESS',
        observations: [
          { step: 1, windowTitle: 'Custom Desktop Client', visualTargetFound: true, actionProposed: 'click(600, 450)', timestamp: Date.now() },
        ],
        actions: ['click(600, 450)'],
        claimedTarget: 'Submit Button',
        evidence: { groundingModel: 'UI-TARS-1.5-7B' },
        durationMs: 350,
        stepCount: 1,
      };
    });

    const step = {
      action: 'ACTIVATE_CONTROL' as any,
      targetType: 'APPLICATION_WINDOW' as any,
      application: 'Custom Desktop Client',
      target: 'Submit Button',
      contentRequest: null,
      ordinal: null,
      count: null,
      worker: null,
      delegationRequested: false,
      confidence: 1.0,
      isDirectCommand: true,
      rawPrompt: 'In Custom Desktop Client, activate Submit Button',
      normalizedPrompt: 'in custom desktop client activate submit button',
      reason: 'Activate Submit Button',
    };

    const result = await guiNavigationCapabilityAdapter.execute(step, 'electron-1', convId);

    expect(agentSInvoked).toBe(true);
    expect(result.success).toBe(true);
    expect(result.verified).toBe(true);
  });

  // ── 7. Verification Authority: Agent-S "SUCCESS" is Proposal Only ────────
  it('rejects proposal when Agent-S claims SUCCESS but AgenticOS verification fails', async () => {
    vi.spyOn(targetResolver, 'getOpenWindows').mockResolvedValue([
      { hwnd: 201, title: 'Telegram', process: 'telegram.exe' },
    ]);

    agentSComputerUseProvider.setMockRunner(async (): Promise<ComputerUseGoalResult> => {
      // Agent-S claims it finished successfully
      return {
        status: 'SUCCESS',
        observations: [],
        actions: ['click(100, 100)'],
        claimedTarget: 'Nonexistent Chat',
        evidence: { forceVerificationFailure: true }, // Simulate verification mismatch
        durationMs: 500,
        stepCount: 1,
      };
    });

    const step = {
      action: 'OPEN_CHAT' as const,
      targetType: 'CHAT_CONVERSATION' as const,
      application: 'Telegram',
      target: 'Nonexistent Chat',
      contentRequest: null,
      ordinal: null,
      count: null,
      worker: null,
      delegationRequested: false,
      confidence: 1.0,
      isDirectCommand: true,
      rawPrompt: 'Open Telegram and locate Nonexistent Chat',
      normalizedPrompt: 'open telegram and locate nonexistent chat',
      reason: 'Locate chat',
    };

    // AgenticOS attempts verification, but window title is still just "Telegram" (not "Nonexistent Chat")
    const result = await chatCapabilityAdapter.execute(step, 'unverified-1', convId);

    // CRITICAL: AgenticOS must NEVER accept Agent-S completion without independent proof!
    expect(result.success).toBe(false);
    expect(result.verified).toBe(false);
    expect(result.failureReason).toContain('could not locate and verify');
  });

  // ── 8. Window Contamination & Sync Window Rejection ──────────────────────
  it('SourceOutcomeVerifier rejects "Null client input sync window" and internal AgenticOS chrome', () => {
    const intent = {
      action: 'READ_MESSAGES' as const,
      targetType: 'CHAT_CONVERSATION' as const,
      application: 'Telegram',
      target: 'Agentic OS',
      contentRequest: null,
      ordinal: null,
      count: 2,
      worker: null,
      delegationRequested: false,
      confidence: 1.0,
      isDirectCommand: true,
      rawPrompt: 'Read messages in Telegram',
      normalizedPrompt: 'read messages in telegram',
      reason: 'Read messages',
    };

    const target = {
      requestedTarget: 'Telegram',
      resolvedApplication: 'Telegram',
      resolvedWindow: 'Telegram',
      isExactMatch: true,
      matchType: 'process_name' as const,
    };

    // Contaminated capture with AgenticOS sync window
    const contaminatedAcquisition = {
      success: true,
      sourceApplication: 'Telegram',
      sourceWindow: 'Null client input sync window app window custom title bar minimize maximize close',
      acquisitionMethod: 'uia' as const,
      content: 'Null client input sync window app window custom title bar minimize maximize close.',
      structuredItems: ['Null client input sync window app window custom title bar minimize maximize close.'],
      timestamp: Date.now(),
      verificationEvidence: {},
      confidence: 0.9,
      visionUsed: false,
      llmUsed: false,
      fallbackCount: 0,
    };

    const evaluation = sourceOutcomeVerifier.verifyContentAcquisition(intent, target, contaminatedAcquisition);

    expect(evaluation.isVerified).toBe(false);
    expect(evaluation.crossTargetContaminationDetected).toBe(true);
    expect(evaluation.failureReason).toContain('internal sync window');
  });
});
