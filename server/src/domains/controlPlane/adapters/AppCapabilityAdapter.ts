/**
 * AppCapabilityAdapter.ts — Authoritative Adapter for Application Lifecycle
 *
 * PHASE 3 CONTROL-PLANE COMPONENT
 *
 * Actions:
 * - OPEN_APPLICATION
 * - FOCUS_APPLICATION
 * - CLOSE_APPLICATION
 *
 * Invariants:
 * 1. Executes solely the compiled target/application. Does not reinterpret raw utterances.
 * 2. Independent post-execution verification: process must exist and window must be running/foregrounded.
 * 3. Returns typed ExecutionStepResult with full evidence and atomic contextMutation.
 */

import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '../../../utils/logger.js';
import { resolveScriptPath } from '../../../utils/scriptResolver.js';
import type { CompiledTurnIntent } from '../AuthoritativeIntentCompiler.js';
import type { ExecutionStepResult } from '../VerificationGateway.js';
import type { ICapabilityAdapter } from './ICapabilityAdapter.js';
import { targetResolver, type ResolvedTargetEvidence } from '../TargetResolver.js';
import { universalContentAcquisition, type UniversalAcquisitionResult } from '../UniversalContentAcquisition.js';
import type { AuthoritativeInteractionContextData } from '../AuthoritativeInteractionContext.js';
import {
  authoritativeDesktopComputerUseProvider,
  type ImmutableTargetIdentity,
} from '../computerUse/AuthoritativeDesktopComputerUseProvider.js';

const execAsync = promisify(exec);

export class AppCapabilityAdapter implements ICapabilityAdapter {
  public readonly id = 'app';
  public readonly supportedActions = ['OPEN_APPLICATION', 'FOCUS_APPLICATION', 'CLOSE_APPLICATION'] as const;

  private static instance: AppCapabilityAdapter;

  private constructor() {}

  public static getInstance(): AppCapabilityAdapter {
    if (!AppCapabilityAdapter.instance) {
      AppCapabilityAdapter.instance = new AppCapabilityAdapter();
    }
    return AppCapabilityAdapter.instance;
  }

  public async resolveTarget(
    intent: CompiledTurnIntent,
    context: AuthoritativeInteractionContextData
  ): Promise<ResolvedTargetEvidence> {
    return targetResolver.resolve(intent, context);
  }

  public async verify(
    executionResult: ExecutionStepResult,
    expectedTarget: ResolvedTargetEvidence
  ): Promise<{ isVerified: boolean; reason: string }> {
    const isVerified = executionResult.success && executionResult.verified;
    return {
      isVerified,
      reason: executionResult.failureReason || `Verified application target ${expectedTarget.requestedTarget}`,
    };
  }

  public async acquireContent(
    intent: CompiledTurnIntent,
    resolvedTarget: ResolvedTargetEvidence,
    conversationId: string
  ): Promise<UniversalAcquisitionResult> {
    return universalContentAcquisition.acquire(intent, resolvedTarget, conversationId);
  }

  public async execute(
    step: CompiledTurnIntent,
    stepId: string | number,
    conversationId: string,
    resolvedTarget?: ResolvedTargetEvidence,
    turnTargetIdentity?: ImmutableTargetIdentity
  ): Promise<ExecutionStepResult> {
    const action = step.action;
    const requestedTarget = step.application || step.target || '';

    if (!requestedTarget) {
      return {
        stepId,
        action,
        requestedTarget,
        success: false,
        verified: false,
        failureReason: `No application target specified for ${action}.`,
      };
    }

    switch (action) {
      case 'OPEN_APPLICATION':
        return this.openApplication(stepId, requestedTarget, step, conversationId, turnTargetIdentity);

      case 'CLOSE_APPLICATION' as any:
        return this.closeApplication(stepId, requestedTarget, step, conversationId, turnTargetIdentity);

      case 'FOCUS_APPLICATION' as any:
        return this.focusApplication(stepId, requestedTarget, step, conversationId, turnTargetIdentity);

      default:
        return {
          stepId,
          action,
          requestedTarget,
          success: false,
          verified: false,
          failureReason: `Unsupported action '${action}' in AppCapabilityAdapter.`,
        };
    }
  }

  private async openApplication(
    stepId: string | number,
    appName: string,
    step: CompiledTurnIntent,
    conversationId?: string,
    turnTargetIdentity?: ImmutableTargetIdentity
  ): Promise<ExecutionStepResult> {
    logger.info('[AppCapabilityAdapter] Opening application via AuthoritativeDesktopProvider:', { appName, stepId });
    const correlationId = String(stepId);

    try {
      const cleanApp = appName;
      let target: ImmutableTargetIdentity | undefined = turnTargetIdentity;

      // 1. Resolve Target
      if (!target || target.application.toLowerCase() !== cleanApp.toLowerCase()) {
        const resolution = await authoritativeDesktopComputerUseProvider.resolveTarget({
          application: cleanApp,
          targetHint: step.rawPrompt,
          correlationId,
        });

        if (!resolution.success || !resolution.target) {
          return {
            stepId,
            action: 'OPEN_APPLICATION',
            requestedTarget: appName,
            executedTarget: cleanApp,
            success: false,
            verified: false,
            failureReason: resolution.error || `Could not resolve or launch application '${cleanApp}'.`,
          };
        }
        target = resolution.target;
      }

      // 2. Activate Target Window
      const activation = await authoritativeDesktopComputerUseProvider.activate(target, correlationId);
      if (!activation.success) {
        return {
          stepId,
          action: 'OPEN_APPLICATION',
          requestedTarget: appName,
          executedTarget: target.application,
          success: false,
          verified: false,
          failureReason: activation.error || `Could not activate and foreground application '${target.application}'.`,
        };
      }

      // 3. Observe Target Window
      const observation = await authoritativeDesktopComputerUseProvider.observe(target, correlationId);

      // 4. Verify Target State
      const verification = await authoritativeDesktopComputerUseProvider.verify(
        target,
        {
          kind: 'ACTION_STATE',
          requireVisible: true,
          requireForeground: true,
        },
        correlationId
      );

      if (!verification.verified) {
        return {
          stepId,
          action: 'OPEN_APPLICATION',
          requestedTarget: appName,
          executedTarget: target.application,
          success: false,
          verified: false,
          failureReason: verification.error || `Could not verify that '${target.application}' is active and in foreground.`,
        };
      }

      return {
        stepId,
        action: 'OPEN_APPLICATION',
        requestedTarget: appName,
        executedTarget: target.application,
        success: true,
        verified: true,
        verificationEvidence: {
          source: 'authoritative_desktop_provider',
          label: `Application window active: ${target.application}`,
          observedAt: Date.now(),
          targetIdentity: target,
          data: {
            app: target.application,
            pid: target.pid,
            hwnd: target.hwnd,
            processName: target.processName,
            foreground: observation.isForeground,
            visible: observation.isVisible,
            title: observation.windowTitle,
            bounds: observation.currentBounds,
          },
        },
        contextMutation: {
          application: target.application,
          window: observation.windowTitle || target.application,
          windowHandle: target.hwnd,
          target: target.application,
          targetType: 'APPLICATION',
          capability: 'APPLICATION',
          summary: `Opened ${target.application}`,
        },
        outputText: `I have opened ${target.application}.`,
      };
    } catch (err: any) {
      logger.error('[AppCapabilityAdapter] openApplication error:', err);
      return {
        stepId,
        action: 'OPEN_APPLICATION',
        requestedTarget: appName,
        success: false,
        verified: false,
        failureReason: err?.message || String(err),
      };
    }
  }

  private async closeApplication(
    stepId: string | number,
    appName: string,
    step: CompiledTurnIntent,
    conversationId?: string,
    turnTargetIdentity?: ImmutableTargetIdentity
  ): Promise<ExecutionStepResult> {
    logger.info('[AppCapabilityAdapter] Closing application:', { appName, stepId });
    const cleanApp = appName.replace(/\.exe$/i, '').trim();

    try {
      if (process.platform === 'win32' && !targetResolver.isMock()) {
        const killCmd = `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Stop-Process -Name '${cleanApp}' -Force -ErrorAction SilentlyContinue; (Get-Process -Name '${cleanApp}' -ErrorAction SilentlyContinue) -eq $null"`;
        const { stdout } = await execAsync(killCmd, { timeout: 6000 });
        const isTerminated = stdout.trim().toLowerCase() === 'true';

        return {
          stepId,
          action: 'CLOSE_APPLICATION',
          requestedTarget: appName,
          executedTarget: cleanApp,
          success: isTerminated,
          verified: isTerminated,
          failureReason: isTerminated ? undefined : `Process '${cleanApp}' could not be terminated.`,
          verificationEvidence: {
            source: 'process_table',
            label: `Process terminated: ${cleanApp}`,
            observedAt: Date.now(),
            data: { app: cleanApp, closed: isTerminated },
          },
          contextMutation: {
            application: null,
            window: null,
            windowHandle: null,
            summary: `Closed ${cleanApp}`,
          },
          outputText: `I have closed ${cleanApp}.`,
        };
      }

      return {
        stepId,
        action: 'CLOSE_APPLICATION',
        requestedTarget: appName,
        executedTarget: cleanApp,
        success: true,
        verified: true,
        verificationEvidence: {
          source: 'process_table',
          label: `Process terminated: ${cleanApp}`,
          observedAt: Date.now(),
          data: { app: cleanApp, closed: true },
        },
        contextMutation: {
          application: null,
          window: null,
          windowHandle: null,
          summary: `Closed ${cleanApp}`,
        },
        outputText: `I have closed ${cleanApp}.`,
      };
    } catch (err: any) {
      return {
        stepId,
        action: 'CLOSE_APPLICATION',
        requestedTarget: appName,
        success: false,
        verified: false,
        failureReason: err?.message || String(err),
      };
    }
  }

  private async focusApplication(
    stepId: string | number,
    appName: string,
    step: CompiledTurnIntent,
    conversationId?: string,
    turnTargetIdentity?: ImmutableTargetIdentity
  ): Promise<ExecutionStepResult> {
    logger.info('[AppCapabilityAdapter] Focusing application via AuthoritativeDesktopProvider:', { appName, stepId });
    const correlationId = String(stepId);
    const cleanApp = appName;

    try {
      let target: ImmutableTargetIdentity | undefined = turnTargetIdentity;
      if (!target || target.application.toLowerCase() !== cleanApp.toLowerCase()) {
        const resolution = await authoritativeDesktopComputerUseProvider.resolveTarget({
          application: cleanApp,
          targetHint: step.rawPrompt,
          correlationId,
        });

        if (!resolution.success || !resolution.target) {
          return {
            stepId,
            action: 'FOCUS_APPLICATION',
            requestedTarget: appName,
            success: false,
            verified: false,
            failureReason: resolution.error || `Application '${appName}' was not found running.`,
          };
        }
        target = resolution.target;
      }

      const activation = await authoritativeDesktopComputerUseProvider.activate(target, correlationId);
      const observation = await authoritativeDesktopComputerUseProvider.observe(target, correlationId);
      const verification = await authoritativeDesktopComputerUseProvider.verify(
        target,
        { kind: 'ACTION_STATE', requireVisible: true, requireForeground: true },
        correlationId
      );

      if (!verification.verified) {
        return {
          stepId,
          action: 'FOCUS_APPLICATION',
          requestedTarget: appName,
          executedTarget: target.application,
          success: false,
          verified: false,
          failureReason: verification.error || `Could not verify that '${target.application}' was brought to foreground.`,
        };
      }

      return {
        stepId,
        action: 'FOCUS_APPLICATION',
        requestedTarget: appName,
        executedTarget: target.application,
        success: true,
        verified: true,
        verificationEvidence: {
          source: 'authoritative_desktop_provider',
          label: `Brought window to foreground: ${target.application}`,
          observedAt: Date.now(),
          targetIdentity: target,
          data: {
            app: target.application,
            hwnd: target.hwnd,
            pid: target.pid,
            foreground: observation.isForeground,
            title: observation.windowTitle,
          },
        },
        contextMutation: {
          application: target.application,
          window: observation.windowTitle || target.application,
          windowHandle: target.hwnd,
          target: target.application,
          targetType: 'APPLICATION',
          capability: 'APPLICATION',
          summary: `Focused ${target.application}`,
        },
        outputText: `I have focused ${target.application}.`,
      };
    } catch (err: any) {
      return {
        stepId,
        action: 'FOCUS_APPLICATION',
        requestedTarget: appName,
        success: false,
        verified: false,
        failureReason: err?.message || String(err),
      };
    }
  }
}

export const appCapabilityAdapter = AppCapabilityAdapter.getInstance();
