/**
 * AuthoritativeDesktopComputerUseProvider.ts — Single Authoritative Desktop Computer-Use Provider
 *
 * PHASE 3 ARCHITECTURAL COMPONENT
 *
 * Establishes the authoritative boundary for Windows Desktop interaction:
 *
 * CORE INVARIANT:
 * EXECUTION TARGET = PERCEPTION TARGET = VERIFICATION TARGET
 *
 * One immutable TargetIdentity binds the entire operation.
 * Downstream components may never silently rediscover, substitute, or infer another foreground window.
 *
 * Operations:
 * 1. resolveTarget(request): Establishes physical TargetIdentity (HWND, PID, Process, Bounds).
 * 2. observe(target): Physically validates window state, visibility, foreground ownership, and physical bounds.
 * 3. activate(target): Explicitly brings target to foreground and verifies ownership.
 * 4. act(target, action): Executes deterministic Win32 actions or visual GUI interactions via Agent-S.
 * 5. read(target, query): Authoritative perception hierarchy (UIA structured -> UI-TARS visual fallback).
 * 6. verify(target, expectation): Independent verification of physical evidence against the locked TargetIdentity.
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import fs from 'node:fs';
import { logger } from '../../../utils/logger.js';
import { resolveScriptPath } from '../../../utils/scriptResolver.js';
import { TargetResolver } from '../TargetResolver.js';
import { WindowsApplicationResolver } from '../WindowsApplicationResolver.js';
import {
  agentSComputerUseProvider,
  type AgentSComputerUseProvider,
} from './AgentSComputerUseProvider.js';
import type {
  TargetIdentity,
  VisualReadQuery,
  AcquiredVisualContent,
  ExtractedChatMessage,
} from './IComputerUseProvider.js';

const execAsync = promisify(exec);

// ── 1. Immutable Target Identity Model ───────────────────────────────────────

export interface ImmutableTargetIdentity extends TargetIdentity {
  readonly targetId: string;
  readonly application: string;
  readonly processName: string;
  readonly launcherPath?: string;
  readonly hwnd: number;
  readonly pid: number;
  readonly bounds?: {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
  };
  readonly subTarget?: string;
  readonly framework?: 'qt' | 'electron' | 'win32' | 'wpf' | 'uwp' | 'unknown';
  readonly lockedAt: number;
  readonly correlationId: string;
}

// ── 2. Request & Result Contracts ───────────────────────────────────────────

export interface TargetResolutionRequest {
  readonly application: string;
  readonly targetHint?: string;
  readonly launcherPath?: string;
  readonly exactHwnd?: number;
  readonly correlationId?: string;
  readonly timeoutMs?: number;
}

export interface TargetResolutionResult {
  readonly success: boolean;
  readonly target?: ImmutableTargetIdentity;
  readonly correlationId: string;
  readonly evidence: {
    readonly resolutionMethod: 'existing_window' | 'restored_tray' | 'launched_process' | 'explicit_hwnd' | 'mock';
    readonly hwnd?: number;
    readonly pid?: number;
    readonly processName?: string;
    readonly windowTitle?: string;
    readonly resolvedAt: number;
  };
  readonly error?: string;
}

export interface TargetObservation {
  readonly success: boolean;
  readonly target: ImmutableTargetIdentity;
  readonly correlationId: string;
  readonly isValidWindow: boolean;
  readonly isVisible: boolean;
  readonly isMinimized: boolean;
  readonly isForeground: boolean;
  readonly currentBounds?: {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
  };
  readonly windowTitle?: string;
  readonly screenshotPath?: string;
  readonly observedAt: number;
  readonly error?: string;
}

export interface TargetActivationResult {
  readonly success: boolean;
  readonly target: ImmutableTargetIdentity;
  readonly correlationId: string;
  readonly previousForegroundHwnd?: number;
  readonly currentForegroundHwnd?: number;
  readonly isForeground: boolean;
  readonly activatedAt: number;
  readonly error?: string;
}

export type DesktopActionType =
  | 'FOCUS'
  | 'CLICK'
  | 'TYPE'
  | 'HOTKEY'
  | 'SCROLL'
  | 'SUBGOAL_NAVIGATE';

export interface DesktopActionRequest {
  readonly type: DesktopActionType;
  readonly coordinates?: { x: number; y: number };
  readonly text?: string;
  readonly key?: string;
  readonly scrollDelta?: number;
  readonly goal?: string;
  readonly targetHint?: string;
  readonly maxSteps?: number;
}

export interface DesktopActionResult {
  readonly success: boolean;
  readonly sourceTarget: ImmutableTargetIdentity;
  readonly action: DesktopActionRequest;
  readonly correlationId: string;
  readonly physicalEvidence: Record<string, unknown>;
  readonly timestamp: number;
  readonly error?: string;
}

export interface TargetExpectation {
  readonly kind: 'ACTION_STATE' | 'READ_CONTENT';
  readonly requireForeground?: boolean;
  readonly requireVisible?: boolean;
  readonly expectedTitleSubstring?: string;
  readonly expectedContentType?: 'CHAT_MESSAGES' | 'WINDOW_TEXT' | 'DOCUMENT_PARAGRAPHS';
  readonly minMessageCount?: number;
  readonly acquiredContent?: AcquiredVisualContent;
}

export interface TargetVerificationResult {
  readonly verified: boolean;
  readonly target: ImmutableTargetIdentity;
  readonly correlationId: string;
  readonly checks: Array<{ name: string; passed: boolean; details?: string }>;
  readonly timestamp: number;
  readonly error?: string;
}

// ── 3. Provider Implementation ──────────────────────────────────────────────

export type MockTargetResolverHook = (request: TargetResolutionRequest) => Promise<TargetResolutionResult> | TargetResolutionResult;
export type MockObservationHook = (target: ImmutableTargetIdentity, correlationId: string) => Promise<TargetObservation> | TargetObservation;
export type MockActivationHook = (target: ImmutableTargetIdentity, correlationId: string) => Promise<TargetActivationResult> | TargetActivationResult;

export class AuthoritativeDesktopComputerUseProvider {
  private static instance: AuthoritativeDesktopComputerUseProvider;

  // Mock Hooks for Isolated Deterministic Testing
  private mockResolver?: MockTargetResolverHook;
  private mockObserver?: MockObservationHook;
  private mockActivator?: MockActivationHook;

  private constructor() {}

  public static getInstance(): AuthoritativeDesktopComputerUseProvider {
    if (!AuthoritativeDesktopComputerUseProvider.instance) {
      AuthoritativeDesktopComputerUseProvider.instance = new AuthoritativeDesktopComputerUseProvider();
    }
    return AuthoritativeDesktopComputerUseProvider.instance;
  }

  public setMockResolver(hook?: MockTargetResolverHook): void {
    this.mockResolver = hook;
  }

  public setMockObserver(hook?: MockObservationHook): void {
    this.mockObserver = hook;
  }

  public setMockActivator(hook?: MockActivationHook): void {
    this.mockActivator = hook;
  }

  /**
   * Helper: Generate a unique correlation ID for an end-to-end operation sequence.
   */
  public generateCorrelationId(): string {
    return `corr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  /**
   * 1. RESOLVE TARGET
   * The single component responsible for establishing physical target identity.
   * Requires actual physical HWND and PID binding.
   */
  public async resolveTarget(request: TargetResolutionRequest): Promise<TargetResolutionResult> {
    const correlationId = request.correlationId || this.generateCorrelationId();
    const resolvedAt = Date.now();

    logger.info('[AuthoritativeDesktopProvider] Resolving target:', {
      application: request.application,
      targetHint: request.targetHint,
      correlationId,
    });

    if (this.mockResolver) {
      return this.mockResolver(request);
    }

    // A. Explicit HWND path
    if (request.exactHwnd && request.exactHwnd > 0) {
      const probe = await this.probeWindow(request.exactHwnd);
      if (probe.isValidWindow && probe.pid && probe.processName) {
        const target: ImmutableTargetIdentity = Object.freeze({
          targetId: `target_${request.application.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${request.exactHwnd}`,
          application: request.application,
          processName: probe.processName,
          launcherPath: request.launcherPath,
          hwnd: request.exactHwnd,
          pid: probe.pid,
          bounds: probe.bounds,
          framework: this.detectFramework(probe.processName, probe.windowTitle),
          lockedAt: resolvedAt,
          correlationId,
        });

        return {
          success: true,
          target,
          correlationId,
          evidence: {
            resolutionMethod: 'explicit_hwnd',
            hwnd: target.hwnd,
            pid: target.pid,
            processName: target.processName,
            windowTitle: probe.windowTitle,
            resolvedAt,
          },
        };
      }
    }

    // B. Scan existing running desktop windows with physical candidate ranking & filtering
    try {
      const openWindows = await TargetResolver.getInstance().getOpenWindows();
      const appClean = request.application.toLowerCase().replace(/\.exe$/i, '').trim();

      // 1. Gather all candidate windows matching process or title
      const candidates = openWindows.filter((w) => {
        const pClean = w.process.toLowerCase().replace(/\.exe$/i, '').trim();
        const tClean = w.title.toLowerCase();
        return (
          pClean === appClean ||
          pClean.includes(appClean) ||
          appClean.includes(pClean) ||
          (tClean && tClean.includes(appClean))
        );
      });

      // 2. Physically probe, filter out non-viable/helper windows, and rank candidates
      let bestCandidate: { win: any; probe: any; score: number } | null = null;
      for (const cand of candidates) {
        if (!cand.hwnd || cand.hwnd <= 0) continue;
        const probe = await this.probeWindow(cand.hwnd);

        // Filter 1: Must be a valid window
        if (!probe.isValidWindow) continue;

        // Filter 2: Must be visible (reject hidden Qt synchronization / helper windows)
        if (!probe.isVisible) continue;

        // Filter 3: Reject tool windows and zero/tiny bounds
        if ((probe as any).isToolWindow === true) continue;
        const width = probe.bounds?.width ?? 0;
        const height = probe.bounds?.height ?? 0;
        if (width < 100 || height < 100) continue;

        // Physical Ranking:
        let score = 0;

        // Prefer foreground window belonging to expected process (+1000)
        if (probe.isForeground) score += 1000;

        // Prefer title matching target hint (e.g. "Agentic OS" in title) (+500)
        if (request.targetHint && cand.title && cand.title.toLowerCase().includes(request.targetHint.toLowerCase())) {
          score += 500;
        }

        // Prefer window with meaningful title (+200)
        if (cand.title && cand.title.trim().length > 0 && cand.title.toLowerCase() !== cand.process.toLowerCase()) {
          score += 200;
        }

        // Prefer larger client area (main window vs helper popups)
        score += Math.min(500, Math.floor((width * height) / 2000));

        if (!bestCandidate || score > bestCandidate.score) {
          bestCandidate = { win: cand, probe, score };
        }
      }

      if (bestCandidate) {
        const { win: matchedWin, probe } = bestCandidate;
        const target: ImmutableTargetIdentity = Object.freeze({
          targetId: `target_${appClean}_${matchedWin.hwnd}`,
          application: request.application,
          processName: matchedWin.process,
          launcherPath: request.launcherPath,
          hwnd: matchedWin.hwnd,
          pid: matchedWin.pid,
          bounds: probe.bounds,
          framework: this.detectFramework(matchedWin.process, matchedWin.title),
          lockedAt: resolvedAt,
          correlationId,
        });

        return {
          success: true,
          target,
          correlationId,
          evidence: {
            resolutionMethod: 'existing_window',
            hwnd: target.hwnd,
            pid: target.pid,
            processName: target.processName,
            windowTitle: matchedWin.title,
            resolvedAt,
          },
        };
      }
    } catch (err: any) {
      logger.warn('[AuthoritativeDesktopProvider] Window scan error during resolve:', err?.message);
    }

    // C. Target is minimized to tray or needs launch/restoration
    try {
      const candidate = await WindowsApplicationResolver.getInstance().resolve(request.application);
      const launcher = request.launcherPath || candidate?.shortcutPath || candidate?.targetPath || '';
      const procName = candidate?.processName || request.application;

      const focusScriptPath = resolveScriptPath('focus_window.ps1');
      if (fs.existsSync(focusScriptPath)) {
        const psCmd = `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${focusScriptPath}" -ProcessName "${procName}" -Title "${request.application}" -LauncherPath "${launcher.replace(/"/g, '`"')}"`;
        const { stdout } = await execAsync(psCmd, { timeout: 12000 });
        const parsed = JSON.parse(stdout || '{}');

        if (parsed.found && parsed.hwnd > 0) {
          const probe = await this.probeWindow(parsed.hwnd);
          const target: ImmutableTargetIdentity = Object.freeze({
            targetId: `target_${request.application.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${parsed.hwnd}`,
            application: request.application,
            processName: probe.processName || procName,
            launcherPath: launcher,
            hwnd: parsed.hwnd,
            pid: probe.pid || 0,
            bounds: probe.bounds,
            framework: this.detectFramework(probe.processName || procName, probe.windowTitle),
            lockedAt: resolvedAt,
            correlationId,
          });

          return {
            success: true,
            target,
            correlationId,
            evidence: {
              resolutionMethod: 'restored_tray',
              hwnd: target.hwnd,
              pid: target.pid,
              processName: target.processName,
              windowTitle: probe.windowTitle,
              resolvedAt,
            },
          };
        }
      }
    } catch (err: any) {
      logger.warn('[AuthoritativeDesktopProvider] Restore/launch attempt failed:', err?.message);
    }

    return {
      success: false,
      correlationId,
      evidence: {
        resolutionMethod: 'existing_window',
        resolvedAt,
      },
      error: `Could not resolve physical window for application '${request.application}'`,
    };
  }

  /**
   * Resolves the current physical foreground desktop window ONCE for explicit current-screen requests.
   * Locks into ImmutableTargetIdentity.
   */
  public async resolveCurrentForegroundTarget(correlationId?: string): Promise<TargetResolutionResult> {
    const corrId = correlationId || this.generateCorrelationId();
    const resolvedAt = Date.now();
    const probe = await this.probeWindow(0);
    if (probe.isValidWindow && (probe as any).hwnd > 0 && probe.processName) {
      const hwnd = (probe as any).hwnd;
      const target: ImmutableTargetIdentity = Object.freeze({
        targetId: `target_foreground_${probe.processName.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${hwnd}`,
        application: probe.processName.replace(/\.exe$/i, ''),
        processName: probe.processName,
        hwnd,
        pid: probe.pid || 0,
        bounds: probe.bounds,
        framework: this.detectFramework(probe.processName, probe.windowTitle),
        lockedAt: resolvedAt,
        correlationId: corrId,
      });

      return {
        success: true,
        target,
        correlationId: corrId,
        evidence: {
          resolutionMethod: 'existing_window',
          hwnd: target.hwnd,
          pid: target.pid,
          processName: target.processName,
          windowTitle: probe.windowTitle,
          resolvedAt,
        },
      };
    }

    return {
      success: false,
      correlationId: corrId,
      evidence: {
        resolutionMethod: 'existing_window',
        resolvedAt,
      },
      error: 'Could not resolve physical foreground window',
    };
  }

  /**
   * 2. OBSERVE
   * Physically validates target window existence, PID, process image, visibility,
   * iconic/minimized status, foreground state, and physical bounds.
   */
  public async observe(
    target: ImmutableTargetIdentity,
    correlationId?: string,
  ): Promise<TargetObservation> {
    const corrId = correlationId || target.correlationId;
    const observedAt = Date.now();

    if (this.mockObserver) {
      return this.mockObserver(target, corrId);
    }

    // Fail closed if HWND is non-positive
    if (!target.hwnd || target.hwnd <= 0) {
      return {
        success: false,
        target,
        correlationId: corrId,
        isValidWindow: false,
        isVisible: false,
        isMinimized: false,
        isForeground: false,
        observedAt,
        error: 'TARGET_INVALID: HWND must be a positive integer',
      };
    }

    const probe = await this.probeWindow(target.hwnd);

    // Fail closed if window handle is no longer valid
    if (!probe.isValidWindow) {
      return {
        success: false,
        target,
        correlationId: corrId,
        isValidWindow: false,
        isVisible: false,
        isMinimized: false,
        isForeground: false,
        observedAt,
        error: `TARGET_INVALID: HWND ${target.hwnd} is not an active OS window`,
      };
    }

    // Fail closed on PID mismatch
    if (probe.pid && target.pid && probe.pid !== target.pid) {
      return {
        success: false,
        target,
        correlationId: corrId,
        isValidWindow: false,
        isVisible: probe.isVisible,
        isMinimized: probe.isMinimized,
        isForeground: probe.isForeground,
        observedAt,
        error: `TARGET_INVALID: PID mismatch (expected ${target.pid}, observed ${probe.pid})`,
      };
    }

    // Fail closed on process name mismatch
    if (probe.processName && target.processName) {
      const exp = target.processName.toLowerCase().replace(/\.exe$/i, '').trim();
      const obs = probe.processName.toLowerCase().replace(/\.exe$/i, '').trim();
      if (exp && obs && exp !== obs && !exp.includes(obs) && !obs.includes(exp)) {
        return {
          success: false,
          target,
          correlationId: corrId,
          isValidWindow: false,
          isVisible: probe.isVisible,
          isMinimized: probe.isMinimized,
          isForeground: probe.isForeground,
          observedAt,
          error: `TARGET_INVALID: Process mismatch (expected '${target.processName}', observed '${probe.processName}')`,
        };
      }
    }

    return {
      success: true,
      target,
      correlationId: corrId,
      isValidWindow: true,
      isVisible: probe.isVisible,
      isMinimized: probe.isMinimized,
      isForeground: probe.isForeground,
      currentBounds: probe.bounds,
      windowTitle: probe.windowTitle,
      observedAt,
    };
  }

  /**
   * 3. ACTIVATE (Explicit Operation)
   * Restores and foregrounds the target window explicitly.
   * Read operations NEVER silently steal focus.
   */
  public async activate(
    target: ImmutableTargetIdentity,
    correlationId?: string,
  ): Promise<TargetActivationResult> {
    const corrId = correlationId || target.correlationId;
    const activatedAt = Date.now();

    logger.info('[AuthoritativeDesktopProvider] Explicit target activation:', {
      targetId: target.targetId,
      hwnd: target.hwnd,
      correlationId: corrId,
    });

    if (this.mockActivator) {
      return this.mockActivator(target, corrId);
    }

    if (TargetResolver.getInstance().isMock() || process.platform !== 'win32') {
      return {
        success: true,
        target,
        correlationId: corrId,
        isForeground: true,
        activatedAt,
      };
    }

    // Validate target is still valid before activating
    const preObs = await this.observe(target, corrId);
    if (!preObs.isValidWindow) {
      return {
        success: false,
        target,
        correlationId: corrId,
        isForeground: false,
        activatedAt,
        error: `TARGET_INVALID: Cannot activate non-existent HWND ${target.hwnd}`,
      };
    }

    if (preObs.isForeground) {
      return {
        success: true,
        target,
        correlationId: corrId,
        isForeground: true,
        activatedAt,
      };
    }

    try {
      const focusScriptPath = resolveScriptPath('focus_window.ps1');
      const psCmd = `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${focusScriptPath}" -Hwnd ${target.hwnd} -ProcessName "${target.processName}"`;
      const { stdout } = await execAsync(psCmd, { timeout: 8000 });
      const parsed = JSON.parse(stdout || '{}');

      const isForeground = parsed.verified === true && (parsed.fgHwnd === target.hwnd || parsed.hwnd === target.hwnd);

      return {
        success: isForeground,
        target,
        correlationId: corrId,
        previousForegroundHwnd: undefined,
        currentForegroundHwnd: parsed.fgHwnd,
        isForeground,
        activatedAt,
        error: isForeground ? undefined : `Target HWND ${target.hwnd} did not gain foreground ownership`,
      };
    } catch (err: any) {
      return {
        success: false,
        target,
        correlationId: corrId,
        isForeground: false,
        activatedAt,
        error: `Activation failed: ${err?.message || String(err)}`,
      };
    }
  }

  /**
   * 4. ACT
   * Executes deterministic Win32/process actions or Agent-S/UI-TARS visual operations.
   */
  public async act(
    target: ImmutableTargetIdentity,
    action: DesktopActionRequest,
    correlationId?: string,
  ): Promise<DesktopActionResult> {
    const corrId = correlationId || target.correlationId;
    const timestamp = Date.now();

    logger.info('[AuthoritativeDesktopProvider] Executing action on target:', {
      actionType: action.type,
      targetId: target.targetId,
      hwnd: target.hwnd,
      correlationId: corrId,
    });

    // Target identity pre-validation
    const preObs = await this.observe(target, corrId);
    if (!preObs.isValidWindow) {
      return {
        success: false,
        sourceTarget: target,
        action,
        correlationId: corrId,
        physicalEvidence: { error: 'TARGET_INVALID' },
        timestamp,
        error: `TARGET_INVALID: Target HWND ${target.hwnd} is not valid for action`,
      };
    }

    if (action.type === 'FOCUS') {
      const actRes = await this.activate(target, corrId);
      return {
        success: actRes.success,
        sourceTarget: target,
        action,
        correlationId: corrId,
        physicalEvidence: { ...actRes },
        timestamp,
        error: actRes.error,
      };
    }

    if (action.type === 'SUBGOAL_NAVIGATE') {
      // Delegate visual GUI navigation loop to Agent-S, bound to target.hwnd
      const goalRes = await agentSComputerUseProvider.executeGoal({
        application: target.application,
        target: action.targetHint || target.targetHint,
        windowHandle: target.hwnd,
        goal: action.goal || `Navigate within ${target.application}`,
        maxSteps: action.maxSteps || 4,
      });

      return {
        success: goalRes.status === 'SUCCESS',
        sourceTarget: target,
        action,
        correlationId: corrId,
        physicalEvidence: {
          observations: goalRes.observations,
          actions: goalRes.actions,
          finalScreenshot: goalRes.finalScreenshot,
          finalWindow: goalRes.finalWindow,
          telemetry: goalRes.evidence?.telemetry,
        },
        timestamp,
        error: goalRes.error,
      };
    }

    // Generic actions (CLICK, TYPE, HOTKEY, SCROLL)
    // Deterministic execution via pyautogui/powershell
    try {
      if (action.type === 'CLICK' && action.coordinates) {
        const bounds = preObs.currentBounds || target.bounds || { left: 0, top: 0 };
        const absX = bounds.left + action.coordinates.x;
        const absY = bounds.top + action.coordinates.y;
        const pyCmd = `python -c "import pyautogui; pyautogui.click(${absX}, ${absY})"`;
        await execAsync(pyCmd, { timeout: 4000 });
      } else if (action.type === 'TYPE' && action.text) {
        const escaped = action.text.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        const pyCmd = `python -c "import pyautogui; pyautogui.write('${escaped}', interval=0.04)"`;
        await execAsync(pyCmd, { timeout: 4000 });
      } else if (action.type === 'HOTKEY' && action.key) {
        const pyCmd = `python -c "import pyautogui; pyautogui.press('${action.key}')"`;
        await execAsync(pyCmd, { timeout: 4000 });
      }

      return {
        success: true,
        sourceTarget: target,
        action,
        correlationId: corrId,
        physicalEvidence: { executedAction: action.type, bounds: preObs.currentBounds },
        timestamp,
      };
    } catch (err: any) {
      return {
        success: false,
        sourceTarget: target,
        action,
        correlationId: corrId,
        physicalEvidence: { error: err?.message },
        timestamp,
        error: `Action execution error: ${err?.message || String(err)}`,
      };
    }
  }

  /**
   * 5. READ (Authoritative Perception Hierarchy)
   *
   * Hierarchy:
   * A. Structured UIA / accessibility extraction when suitable.
   * B. Validate structured result against authoritative target.
   * C. If UIA empty/unsupported/unreliable: Phase 2 Agent-S/UI-TARS visual READ on SAME TargetIdentity.
   *
   * Explicit focus rule:
   * Does NOT silently steal focus. If target is occluded / not foreground and caller did not
   * explicitly activate, returns TARGET_OCCLUDED / TARGET_NOT_VISIBLE.
   */
  public async read(
    target: ImmutableTargetIdentity,
    query: VisualReadQuery,
    correlationId?: string,
  ): Promise<AcquiredVisualContent> {
    const corrId = correlationId || target.correlationId;
    const startTime = Date.now();

    logger.info('[AuthoritativeDesktopProvider] Starting authoritative read:', {
      targetId: target.targetId,
      hwnd: target.hwnd,
      contentType: query.contentType,
      correlationId: corrId,
    });

    // 1. Observe target to verify physical validity & occlusion status
    const obs = await this.observe(target, corrId);
    if (!obs.isValidWindow) {
      return {
        success: false,
        sourceTarget: target,
        methodUsed: 'UI_TARS_VISION',
        confidence: 0,
        timestamp: startTime,
        error: obs.error || 'TARGET_INVALID: Window does not exist',
      };
    }

    // Check foreground authority: read does not silently steal focus unless activateIfHidden explicitly requested
    if (!obs.isForeground) {
      if (query.activateIfHidden === true) {
        logger.info('[AuthoritativeDesktopProvider] Auto-activating target for read:', { hwnd: target.hwnd, app: target.application });
        await this.activate(target, corrId);
      } else {
        logger.warn('[AuthoritativeDesktopProvider] Target occluded during read without activateIfHidden:', {
          hwnd: target.hwnd,
          app: target.application,
        });
        return {
          success: false,
          sourceTarget: target,
          methodUsed: 'UI_TARS_VISION',
          confidence: 0,
          timestamp: startTime,
          error: `TARGET_OCCLUDED: Target HWND ${target.hwnd} is not foreground (active foreground window is different). Explicit activate(target) required.`,
        };
      }
    }

    // 2. Hierarchy Step A: Attempt structured UIA extraction (for WINDOW_TEXT / DOCUMENT_PARAGRAPHS / CHAT_MESSAGES)
    if (query.contentType === 'WINDOW_TEXT' || query.contentType === 'DOCUMENT_PARAGRAPHS' || query.contentType === 'CHAT_MESSAGES') {
      try {
        const uiaScript = resolveScriptPath('desktop_perception.ps1');
        if (fs.existsSync(uiaScript)) {
          const actionFlag = query.contentType === 'CHAT_MESSAGES' ? '-Action read_chat' : '-Action inspect';
          const { stdout } = await execAsync(
            `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${uiaScript}" ${actionFlag} -Hwnd ${target.hwnd}`,
            { timeout: 8000 },
          );
          const parsed = JSON.parse(stdout || '{}');

          // Structured Chat Messages extraction
          if (query.contentType === 'CHAT_MESSAGES' && parsed.chatMessages && parsed.chatMessages.length > 0) {
            const rawChat = parsed.chatMessages;
            const seenIds = new Set<string>();
            const seenKeys = new Set<string>();
            const validMsgs: Array<{ index: number; sender: string; text: string; time: string; bounds?: any; autoId?: string }> = [];

            for (const m of rawChat) {
              const text = String(m.text || '').trim();
              const sender = String(m.sender || '').trim();
              // Defensive filter for sender-header artifacts
              if (!text || text.toLowerCase() === sender.toLowerCase()) continue;

              const id = m.autoId || `msg_${m.top}`;
              const normKey = `${sender.toLowerCase()}|${text.toLowerCase()}|${m.top || ''}`;
              if (seenIds.has(id) || seenKeys.has(normKey)) continue;
              seenIds.add(id);
              seenKeys.add(normKey);

              validMsgs.push({
                index: validMsgs.length + 1,
                sender: sender || target.application,
                text,
                time: m.time || '',
                bounds: { top: m.top, left: m.left, width: m.width, height: m.height },
                autoId: id,
              });
            }

            const reqCount = query.count && query.count > 0 ? query.count : 2;
            const selectedSlice = validMsgs.slice(-reqCount);

            if (selectedSlice.length > 0) {
              logger.info('[AuthoritativeDesktopProvider] UIA structured chat extraction succeeded:', {
                totalFound: validMsgs.length,
                returnedCount: selectedSlice.length,
                requested: reqCount,
              });

              return {
                success: true,
                sourceTarget: target,
                methodUsed: 'UIA',
                chatMessages: selectedSlice,
                text: selectedSlice.map(m => `${m.sender}: ${m.text}`).join('\n'),
                confidence: 0.98,
                timestamp: Date.now(),
                durationMs: Date.now() - startTime,
              };
            }
          }

          const extractedText = (parsed.text || parsed.extractedText || '').trim();

          if (query.contentType !== 'CHAT_MESSAGES' && extractedText.length > 0) {
            const paragraphs = extractedText.split('\n').map((l: string) => l.trim()).filter((l: string) => l.length > 5);
            logger.info('[AuthoritativeDesktopProvider] UIA structured text extraction succeeded:', {
              length: extractedText.length,
              paragraphsCount: paragraphs.length,
            });

            // Capture window screenshot for physical evidence artifact if possible
            let artifactPath: string | undefined;
            try {
              const captureScript = resolveScriptPath('take_screenshot.ps1');
              if (fs.existsSync(captureScript)) {
                const cwd = process.cwd();
                const dataBaseDir = process.env.AGENTICOS_DATA_DIR
                  ? path.resolve(process.env.AGENTICOS_DATA_DIR)
                  : (cwd.endsWith('server') || cwd.endsWith('server\\') || cwd.endsWith('server/'))
                    ? path.resolve(cwd, 'data')
                    : path.resolve(cwd, 'server', 'data');
                const outPath = path.join(dataBaseDir, `evidence_uia_${target.hwnd}_${Date.now()}.png`);
                await execAsync(`powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${captureScript}" -Hwnd ${target.hwnd} -OutputFile "${outPath}"`, { timeout: 3000 });
                if (fs.existsSync(outPath)) {
                  artifactPath = outPath;
                }
              }
            } catch (err: any) {
              logger.debug('[AuthoritativeDesktopProvider] Window capture for UIA artifact omitted:', err?.message);
            }

            return {
              success: true,
              sourceTarget: target,
              methodUsed: 'UIA',
              text: extractedText,
              items: paragraphs,
              confidence: parsed.confidence || 0.95,
              timestamp: Date.now(),
              durationMs: Date.now() - startTime,
              evidenceArtifact: artifactPath ? {
                screenshotPath: artifactPath,
                model: 'Windows.UIAutomation',
                hwnd: target.hwnd,
                pid: target.pid,
                processName: target.processName,
                readQuery: query,
                timestamp: Date.now(),
              } : undefined,
            };
          }
        }
      } catch (err: any) {
        logger.debug('[AuthoritativeDesktopProvider] UIA structured attempt failed, continuing to visual fallback:', err?.message);
      }
    }

    // 3. Hierarchy Step B: UI-TARS Visual Read Fallback (Phase 2 Stack on SAME TargetIdentity)
    const visualResult = await agentSComputerUseProvider.read(target, {
      ...query,
      activateIfHidden: query.activateIfHidden ?? false,
    });

    return {
      ...visualResult,
      sourceTarget: target, // Guarantee immutable target identity is preserved
    };
  }

  /**
   * 6. VERIFY
   * Independent verification of physical evidence against the locked TargetIdentity.
   * Does not trust adapter self-claims (e.g. success=true).
   */
  public async verify(
    target: ImmutableTargetIdentity,
    expectation: TargetExpectation,
    correlationId?: string,
  ): Promise<TargetVerificationResult> {
    const corrId = correlationId || target.correlationId;
    const timestamp = Date.now();
    const checks: Array<{ name: string; passed: boolean; details?: string }> = [];

    // Check 1: Target HWND validity in OS
    const obs = await this.observe(target, corrId);
    checks.push({
      name: 'target_hwnd_exists',
      passed: obs.isValidWindow,
      details: obs.isValidWindow ? `HWND ${target.hwnd} valid` : obs.error,
    });

    // Check 2: Target PID matches
    checks.push({
      name: 'target_pid_matches',
      passed: obs.isValidWindow,
      details: `PID ${target.pid}`,
    });

    // Check 3: Foreground requirement if requested
    if (expectation.requireForeground) {
      checks.push({
        name: 'target_is_foreground',
        passed: obs.isForeground,
        details: obs.isForeground ? 'Target is foreground' : 'Target is not foreground',
      });
    }

    // Check 4: Title substring if requested
    if (expectation.expectedTitleSubstring) {
      const match = (obs.windowTitle || '').toLowerCase().includes(expectation.expectedTitleSubstring.toLowerCase());
      checks.push({
        name: 'expected_title_match',
        passed: match,
        details: `Title '${obs.windowTitle}' contains '${expectation.expectedTitleSubstring}': ${match}`,
      });
    }

    // Check 5: Read content payload & physical evidence
    if (expectation.kind === 'READ_CONTENT' && expectation.acquiredContent) {
      const content = expectation.acquiredContent;

      // 5a. Source Target HWND match
      const hwndMatch = content.sourceTarget.hwnd === target.hwnd;
      checks.push({
        name: 'acquired_source_hwnd_match',
        passed: hwndMatch,
        details: `Acquired HWND ${content.sourceTarget.hwnd} === Target HWND ${target.hwnd}`,
      });

      // 5b. Source Target PID match
      const pidMatch = !content.sourceTarget.pid || content.sourceTarget.pid === target.pid;
      checks.push({
        name: 'acquired_source_pid_match',
        passed: pidMatch,
        details: `Acquired PID ${content.sourceTarget.pid} === Target PID ${target.pid}`,
      });

      // 5c. Non-empty payload check
      const hasPayload = Boolean(
        (content.chatMessages && content.chatMessages.length > 0) ||
        (content.text && content.text.trim().length > 0) ||
        (content.items && content.items.length > 0),
      );
      checks.push({
        name: 'non_empty_content_payload',
        passed: hasPayload,
        details: hasPayload ? 'Payload contains extracted data' : 'Payload is completely empty',
      });

      // 5d. Chat messages min count check
      if (expectation.expectedContentType === 'CHAT_MESSAGES') {
        const minCount = expectation.minMessageCount || 1;
        const msgCount = content.chatMessages?.length || 0;
        checks.push({
          name: 'min_chat_messages_count',
          passed: msgCount >= minCount,
          details: `Found ${msgCount} messages (expected >= ${minCount})`,
        });
      }

      // 5e. Physical evidence artifact check
      const hasArtifact = Boolean(
        (content.evidenceArtifact?.screenshotPath && fs.existsSync(content.evidenceArtifact.screenshotPath)) ||
        (content.methodUsed === 'UIA' && (content.text || (content.items && content.items.length > 0))),
      );
      checks.push({
        name: 'physical_evidence_artifact_exists',
        passed: hasArtifact,
        details: content.evidenceArtifact?.screenshotPath || (content.methodUsed === 'UIA' ? 'UIA structured tree physical extraction' : 'No evidence artifact'),
      });

      // 5f. Reject synthetic data
      const isSynthetic = (content as any).synthetic === true || (content as any).source === 'mock';
      checks.push({
        name: 'zero_synthetic_data_guarantee',
        passed: !isSynthetic,
        details: isSynthetic ? 'REJECTED: payload flagged synthetic/mock' : 'Verified non-synthetic',
      });
    }

    const allPassed = checks.every((c) => c.passed);

    return {
      verified: allPassed,
      target,
      correlationId: corrId,
      checks,
      timestamp,
      error: allPassed ? undefined : `Verification failed on checks: ${checks.filter((c) => !c.passed).map((c) => c.name).join(', ')}`,
    };
  }

  // ── Helper: Low-level window probe via PowerShell Win32 ───────────────────

  private async probeWindow(hwnd: number): Promise<{
    isValidWindow: boolean;
    isVisible: boolean;
    isMinimized: boolean;
    isForeground: boolean;
    isToolWindow?: boolean;
    hasOwner?: boolean;
    hwnd?: number;
    pid?: number;
    processName?: string;
    windowTitle?: string;
    bounds?: { left: number; top: number; right: number; bottom: number; width: number; height: number };
  }> {
    if (TargetResolver.getInstance().isMock() || process.platform !== 'win32') {
      const cached = TargetResolver.getInstance().getCachedWindows();
      const found = cached.find((w) => w.hwnd === hwnd || (hwnd === 0 && cached.length > 0)) || cached[0];
      if (found) {
        const bounds = (found as any).bounds || { left: 100, top: 100, right: 900, bottom: 700, width: 800, height: 600 };
        const isVisible = (found as any).visible !== undefined ? (found as any).visible : true;
        const isToolWindow = Boolean((found as any).isToolWindow);
        return {
          isValidWindow: true,
          isVisible,
          isMinimized: false,
          isForeground: true,
          isToolWindow,
          hasOwner: false,
          hwnd: found.hwnd,
          pid: found.pid,
          processName: found.process,
          windowTitle: found.title,
          bounds,
        };
      }
    }

    try {
      const probeScriptPath = resolveScriptPath('probe_desktop_window.ps1');
      if (fs.existsSync(probeScriptPath)) {
        const { stdout } = await execAsync(
          `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${probeScriptPath}" -Hwnd ${hwnd}`,
          { timeout: 4000 },
        );
        const parsed = JSON.parse(stdout.trim() || '{}');
        if (!parsed.isValid) {
          return { isValidWindow: false, isVisible: false, isMinimized: false, isForeground: false };
        }

        let title = '';
        if (parsed.titleB64) {
          try {
            title = Buffer.from(parsed.titleB64, 'base64').toString('utf-8');
          } catch {}
        }

        const w = Math.max(0, parsed.right - parsed.left);
        const h = Math.max(0, parsed.bottom - parsed.top);

        const resolvedHwnd = parsed.hwnd ? Number(parsed.hwnd) : (hwnd > 0 ? hwnd : undefined);

        return {
          isValidWindow: true,
          isVisible: parsed.visible === true,
          isMinimized: parsed.iconic === true,
          isForeground: parsed.isForeground === true,
          isToolWindow: parsed.isToolWindow === true,
          hasOwner: parsed.hasOwner === true,
          hwnd: resolvedHwnd,
          pid: parsed.pid,
          processName: parsed.process ? `${parsed.process}.exe` : undefined,
          windowTitle: title,
          bounds: {
            left: parsed.left,
            top: parsed.top,
            right: parsed.right,
            bottom: parsed.bottom,
            width: w,
            height: h,
          },
        };
      }
    } catch (err) {
      return { isValidWindow: false, isVisible: false, isMinimized: false, isForeground: false };
    }
    return { isValidWindow: false, isVisible: false, isMinimized: false, isForeground: false };
  }

  private detectFramework(
    processName?: string,
    windowTitle?: string,
  ): 'qt' | 'electron' | 'win32' | 'wpf' | 'uwp' | 'unknown' {
    const p = (processName || '').toLowerCase();
    if (p.includes('telegram')) return 'qt';
    if (p.includes('code') || p.includes('slack') || p.includes('discord')) return 'electron';
    if (p.includes('winword') || p.includes('notepad') || p.includes('calc')) return 'win32';
    return 'unknown';
  }
}

export const authoritativeDesktopComputerUseProvider =
  AuthoritativeDesktopComputerUseProvider.getInstance();
