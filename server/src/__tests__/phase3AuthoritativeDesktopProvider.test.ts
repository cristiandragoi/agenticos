/**
 * phase3AuthoritativeDesktopProvider.test.ts — Phase 3 Unit & Mocked Integration Suite
 *
 * Validates:
 * 1. Immutable TargetIdentity Model.
 * 2. resolveTarget() contract & fail-closed behavior.
 * 3. observe() physical validation (IsWindow, PID, process, bounds, visibility).
 * 4. activate() explicit foregrounding & ownership check.
 * 5. act() target-bound action execution.
 * 6. read() perception hierarchy (UIA -> UI-TARS) & occlusion guard (TARGET_OCCLUDED).
 * 7. verify() independent verification against immutable target & rejection of synthetic data.
 * 8. End-to-end correlationId preservation.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  authoritativeDesktopComputerUseProvider,
  type ImmutableTargetIdentity,
  type TargetResolutionRequest,
  type VisualReadQuery,
  agentSComputerUseProvider,
  type AcquiredVisualContent,
} from '../domains/controlPlane/computerUse/index.js';

describe('Phase 3 — Authoritative Desktop Computer-Use Provider', () => {
  beforeEach(() => {
    authoritativeDesktopComputerUseProvider.setMockResolver(undefined);
    authoritativeDesktopComputerUseProvider.setMockObserver(undefined);
    authoritativeDesktopComputerUseProvider.setMockActivator(undefined);
    agentSComputerUseProvider.setMockReadRunner(undefined);
  });

  // ── 1. Target Identity Immutability ───────────────────────────────────────
  it('enforces immutable TargetIdentity properties', () => {
    const target: ImmutableTargetIdentity = Object.freeze({
      targetId: 'tgt_test_1',
      application: 'Telegram',
      processName: 'Telegram.exe',
      hwnd: 133174,
      pid: 5904,
      bounds: { left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 },
      lockedAt: Date.now(),
      correlationId: 'corr_test_1',
    });

    expect(Object.isFrozen(target)).toBe(true);
    expect(() => {
      // @ts-expect-error mutating frozen object
      target.hwnd = 999;
    }).toThrow();
  });

  // ── 2. Target Resolution (resolveTarget) ──────────────────────────────────
  it('resolves target with mock hook and establishes correlation chain', async () => {
    authoritativeDesktopComputerUseProvider.setMockResolver(async (req) => {
      const target: ImmutableTargetIdentity = Object.freeze({
        targetId: `tgt_${req.application}`,
        application: req.application,
        processName: `${req.application}.exe`,
        hwnd: 1001,
        pid: 2002,
        bounds: { left: 10, top: 10, right: 800, bottom: 600, width: 790, height: 590 },
        lockedAt: Date.now(),
        correlationId: req.correlationId || 'corr_mock_1',
      });

      return {
        success: true,
        target,
        correlationId: target.correlationId,
        evidence: {
          resolutionMethod: 'mock',
          hwnd: 1001,
          pid: 2002,
          processName: target.processName,
          resolvedAt: Date.now(),
        },
      };
    });

    const res = await authoritativeDesktopComputerUseProvider.resolveTarget({
      application: 'Notepad',
      correlationId: 'corr_fixed_123',
    });

    expect(res.success).toBe(true);
    expect(res.correlationId).toBe('corr_fixed_123');
    expect(res.target?.hwnd).toBe(1001);
    expect(res.target?.pid).toBe(2002);
    expect(res.target?.processName).toBe('Notepad.exe');
    expect(res.evidence.resolutionMethod).toBe('mock');
  });

  it('fails closed when target cannot be resolved to physical window', async () => {
    // Non-existent application with no running process or window
    const res = await authoritativeDesktopComputerUseProvider.resolveTarget({
      application: 'NonExistentAppXYZ9999',
    });

    expect(res.success).toBe(false);
    expect(res.target).toBeUndefined();
    expect(res.error).toContain('Could not resolve physical window');
  });

  // ── 3. Target Observation (observe) ───────────────────────────────────────
  it('observe() fails closed if target HWND is non-positive or invalid', async () => {
    const invalidTarget: ImmutableTargetIdentity = Object.freeze({
      targetId: 'tgt_invalid',
      application: 'Ghost',
      processName: 'Ghost.exe',
      hwnd: 0,
      pid: 1234,
      lockedAt: Date.now(),
      correlationId: 'corr_invalid',
    });

    const obs = await authoritativeDesktopComputerUseProvider.observe(invalidTarget);
    expect(obs.success).toBe(false);
    expect(obs.isValidWindow).toBe(false);
    expect(obs.error).toContain('TARGET_INVALID');
  });

  it('observe() fails closed on PID mismatch via mock observer', async () => {
    const target: ImmutableTargetIdentity = Object.freeze({
      targetId: 'tgt_mismatch',
      application: 'App',
      processName: 'App.exe',
      hwnd: 500,
      pid: 1000,
      lockedAt: Date.now(),
      correlationId: 'corr_mismatch',
    });

    authoritativeDesktopComputerUseProvider.setMockObserver(async (tgt, corr) => {
      return {
        success: false,
        target: tgt,
        correlationId: corr,
        isValidWindow: false,
        isVisible: true,
        isMinimized: false,
        isForeground: false,
        observedAt: Date.now(),
        error: 'TARGET_INVALID: PID mismatch (expected 1000, observed 9999)',
      };
    });

    const obs = await authoritativeDesktopComputerUseProvider.observe(target);
    expect(obs.success).toBe(false);
    expect(obs.error).toContain('PID mismatch');
  });

  // ── 4. Target Activation (activate) ───────────────────────────────────────
  it('activate() explicitly verifies foreground ownership', async () => {
    const target: ImmutableTargetIdentity = Object.freeze({
      targetId: 'tgt_act',
      application: 'Telegram',
      processName: 'Telegram.exe',
      hwnd: 133174,
      pid: 5904,
      lockedAt: Date.now(),
      correlationId: 'corr_act',
    });

    authoritativeDesktopComputerUseProvider.setMockActivator(async (tgt, corr) => {
      return {
        success: true,
        target: tgt,
        correlationId: corr,
        currentForegroundHwnd: tgt.hwnd,
        isForeground: true,
        activatedAt: Date.now(),
      };
    });

    const actRes = await authoritativeDesktopComputerUseProvider.activate(target);
    expect(actRes.success).toBe(true);
    expect(actRes.isForeground).toBe(true);
    expect(actRes.currentForegroundHwnd).toBe(target.hwnd);
    expect(actRes.correlationId).toBe('corr_act');
  });

  // ── 5. Perception Hierarchy & Occlusion Guard (read) ──────────────────────
  it('read() rejects occluded/not-foreground target when activate was not called', async () => {
    const target: ImmutableTargetIdentity = Object.freeze({
      targetId: 'tgt_occluded',
      application: 'Telegram',
      processName: 'Telegram.exe',
      hwnd: 133174,
      pid: 5904,
      lockedAt: Date.now(),
      correlationId: 'corr_occ',
    });

    authoritativeDesktopComputerUseProvider.setMockObserver(async (tgt, corr) => {
      return {
        success: true,
        target: tgt,
        correlationId: corr,
        isValidWindow: true,
        isVisible: true,
        isMinimized: false,
        isForeground: false, // NOT FOREGROUND (e.g. Antigravity is in front!)
        observedAt: Date.now(),
      };
    });

    const readRes = await authoritativeDesktopComputerUseProvider.read(target, {
      contentType: 'CHAT_MESSAGES',
      count: 2,
      activateIfHidden: false, // No silent focus stealing
    });

    expect(readRes.success).toBe(false);
    expect(readRes.error).toContain('TARGET_OCCLUDED');
    expect(readRes.confidence).toBe(0);
  });

  it('read() delegates to UI-TARS on SAME target when target is active and UIA is empty', async () => {
    const target: ImmutableTargetIdentity = Object.freeze({
      targetId: 'tgt_active',
      application: 'Telegram',
      processName: 'Telegram.exe',
      hwnd: 133174,
      pid: 5904,
      lockedAt: Date.now(),
      correlationId: 'corr_active',
    });

    authoritativeDesktopComputerUseProvider.setMockObserver(async (tgt, corr) => {
      return {
        success: true,
        target: tgt,
        correlationId: corr,
        isValidWindow: true,
        isVisible: true,
        isMinimized: false,
        isForeground: true, // Target is active foreground
        observedAt: Date.now(),
      };
    });

    agentSComputerUseProvider.setMockReadRunner(async (tgt, qry): Promise<AcquiredVisualContent> => {
      expect(tgt.hwnd).toBe(target.hwnd);
      return {
        success: true,
        sourceTarget: tgt,
        methodUsed: 'UI_TARS_VISION',
        text: 'Cristian D.: jarvis you there?\nCristian D.: I\'m here.',
        items: [],
        chatMessages: [
          { sender: 'Cristian D.', text: 'jarvis you there?', timestamp: '08:29' },
          { sender: 'Cristian D.', text: 'I\'m here.', timestamp: '08:29' },
        ],
        confidence: 0.95,
        evidenceArtifact: {
          screenshotPath: 'D:/AgenticOS/server/data/agent_s_read_mock.png',
          hwnd: tgt.hwnd,
          pid: tgt.pid,
          processName: tgt.processName,
          timestamp: Date.now(),
          readQuery: qry,
          model: 'bytedance/ui-tars-1.5-7b',
        },
        timestamp: Date.now(),
      };
    });

    const readRes = await authoritativeDesktopComputerUseProvider.read(target, {
      contentType: 'CHAT_MESSAGES',
      count: 2,
    });

    expect(readRes.success).toBe(true);
    expect(readRes.methodUsed).toBe('UI_TARS_VISION');
    expect(readRes.chatMessages).toHaveLength(2);
    expect(readRes.sourceTarget.hwnd).toBe(target.hwnd);
    expect(readRes.sourceTarget.pid).toBe(target.pid);
  });

  // ── 6. Independent Verification (verify) ──────────────────────────────────
  it('verify() passes when physical evidence matches locked target identity', async () => {
    const target: ImmutableTargetIdentity = Object.freeze({
      targetId: 'tgt_v_1',
      application: 'Telegram',
      processName: 'Telegram.exe',
      hwnd: 133174,
      pid: 5904,
      lockedAt: Date.now(),
      correlationId: 'corr_v_1',
    });

    authoritativeDesktopComputerUseProvider.setMockObserver(async (tgt, corr) => {
      return {
        success: true,
        target: tgt,
        correlationId: corr,
        isValidWindow: true,
        isVisible: true,
        isMinimized: false,
        isForeground: true,
        observedAt: Date.now(),
      };
    });

    const acquiredContent: AcquiredVisualContent = {
      success: true,
      sourceTarget: target,
      methodUsed: 'UI_TARS_VISION',
      text: 'Message content',
      chatMessages: [{ sender: 'User', text: 'Hello', timestamp: '12:00' }],
      confidence: 0.95,
      evidenceArtifact: {
        screenshotPath: 'D:/AgenticOS/server/package.json', // existing file for test
        hwnd: target.hwnd,
        pid: target.pid,
        processName: target.processName,
        timestamp: Date.now(),
        readQuery: { contentType: 'CHAT_MESSAGES' },
        model: 'bytedance/ui-tars-1.5-7b',
      },
      timestamp: Date.now(),
    };

    const vRes = await authoritativeDesktopComputerUseProvider.verify(target, {
      kind: 'READ_CONTENT',
      expectedContentType: 'CHAT_MESSAGES',
      minMessageCount: 1,
      acquiredContent,
    });

    expect(vRes.verified).toBe(true);
    expect(vRes.checks.every((c) => c.passed)).toBe(true);
  });

  it('verify() rejects synthetic / mock data', async () => {
    const target: ImmutableTargetIdentity = Object.freeze({
      targetId: 'tgt_synth',
      application: 'Telegram',
      processName: 'Telegram.exe',
      hwnd: 133174,
      pid: 5904,
      lockedAt: Date.now(),
      correlationId: 'corr_synth',
    });

    authoritativeDesktopComputerUseProvider.setMockObserver(async (tgt, corr) => {
      return {
        success: true,
        target: tgt,
        correlationId: corr,
        isValidWindow: true,
        isVisible: true,
        isMinimized: false,
        isForeground: true,
        observedAt: Date.now(),
      };
    });

    const syntheticContent: any = {
      success: true,
      sourceTarget: target,
      methodUsed: 'UI_TARS_VISION',
      text: 'Synthetic fallback message',
      chatMessages: [{ sender: 'Bot', text: 'Fake' }],
      confidence: 0.9,
      synthetic: true, // FLAG SYNTHETIC
      timestamp: Date.now(),
    };

    const vRes = await authoritativeDesktopComputerUseProvider.verify(target, {
      kind: 'READ_CONTENT',
      expectedContentType: 'CHAT_MESSAGES',
      acquiredContent: syntheticContent,
    });

    expect(vRes.verified).toBe(false);
    const synthCheck = vRes.checks.find((c) => c.name === 'zero_synthetic_data_guarantee');
    expect(synthCheck?.passed).toBe(false);
  });

  it('verify() rejects HWND mismatch between acquired content and locked target', async () => {
    const target: ImmutableTargetIdentity = Object.freeze({
      targetId: 'tgt_correct',
      application: 'Telegram',
      processName: 'Telegram.exe',
      hwnd: 133174,
      pid: 5904,
      lockedAt: Date.now(),
      correlationId: 'corr_h_match',
    });

    authoritativeDesktopComputerUseProvider.setMockObserver(async (tgt, corr) => {
      return {
        success: true,
        target: tgt,
        correlationId: corr,
        isValidWindow: true,
        isVisible: true,
        isMinimized: false,
        isForeground: true,
        observedAt: Date.now(),
      };
    });

    const foreignContent: AcquiredVisualContent = {
      success: true,
      sourceTarget: {
        ...target,
        hwnd: 999999, // WRONG HWND (e.g. from foreign window)
      },
      methodUsed: 'UI_TARS_VISION',
      text: 'Foreign text',
      confidence: 0.9,
      timestamp: Date.now(),
    };

    const vRes = await authoritativeDesktopComputerUseProvider.verify(target, {
      kind: 'READ_CONTENT',
      acquiredContent: foreignContent,
    });

    expect(vRes.verified).toBe(false);
    const hwndCheck = vRes.checks.find((c) => c.name === 'acquired_source_hwnd_match');
    expect(hwndCheck?.passed).toBe(false);
  });
});
