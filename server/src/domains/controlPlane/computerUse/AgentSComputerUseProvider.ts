/**
 * AgentSComputerUseProvider.ts — Agent-S3 Computer Use Provider
 *
 * PHASE 6B ARCHITECTURAL COMPONENT
 *
 * Bridges AgenticOS control plane to simular-ai/Agent-S (gui-agents v0.3.0).
 * Grounding Model: UI-TARS-1.5-7B (visual grounding engine).
 *
 * CRITICAL ARCHITECTURAL CONSTRAINTS:
 * 1. Agent-S remains SUBORDINATE to AgenticOS.
 * 2. Agent-S is responsible ONLY for the GUI interaction loop:
 *    OBSERVE SCREEN -> UNDERSTAND GUI -> PLAN GUI STEP -> ACTION -> OBSERVE AGAIN -> UNTIL SUBGOAL.
 * 3. Agent-S output is a PROPOSAL — it NEVER declares final success.
 * 4. AgenticOS SourceOutcomeVerifier independently verifies resulting state.
 * 5. Bounded execution: strict timeoutMs and maxSteps limits.
 */

import { exec, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import fs from 'node:fs';
import { logger } from '../../../utils/logger.js';
import { resolveScriptPath } from '../../../utils/scriptResolver.js';
import type {
  IComputerUseProvider,
  ComputerUseGoalRequest,
  ComputerUseGoalResult,
  ComputerUseObservation,
  TargetIdentity,
  VisualReadQuery,
  ExtractedChatMessage,
  VisualReadEvidenceArtifact,
  AcquiredVisualContent,
} from './IComputerUseProvider.js';

const execAsync = promisify(exec);

export type AgentSMockRunner = (request: ComputerUseGoalRequest) => Promise<ComputerUseGoalResult> | ComputerUseGoalResult;
export type AgentSMockReadRunner = (target: TargetIdentity, query: VisualReadQuery) => Promise<AcquiredVisualContent> | AcquiredVisualContent;

export class AgentSComputerUseProvider implements IComputerUseProvider {
  public readonly id = 'agent-s3';
  public readonly name = 'Agent-S3 Computer Use Provider';
  public readonly version = '0.3.0';
  public readonly supportedPlatforms = ['win32', 'linux', 'darwin'] as const;

  private static instance: AgentSComputerUseProvider;
  private mockRunner?: AgentSMockRunner;
  private mockReadRunner?: AgentSMockReadRunner;

  private constructor() {}

  public static getInstance(): AgentSComputerUseProvider {
    if (!AgentSComputerUseProvider.instance) {
      AgentSComputerUseProvider.instance = new AgentSComputerUseProvider();
    }
    return AgentSComputerUseProvider.instance;
  }

  public setMockRunner(runner?: AgentSMockRunner): void {
    this.mockRunner = runner;
  }

  public hasMockRunner(): boolean {
    return Boolean(this.mockRunner);
  }

  public setMockReadRunner(runner?: AgentSMockReadRunner): void {
    this.mockReadRunner = runner;
  }

  public hasMockReadRunner(): boolean {
    return Boolean(this.mockReadRunner);
  }

  public async isAvailable(): Promise<boolean> {
    if (this.mockRunner) return true;

    // Check if python and the bridge script are available
    try {
      const bridgePath = resolveScriptPath('agent_s_bridge.py');
      if (fs.existsSync(bridgePath)) {
        return true;
      }
    } catch {}

    return false;
  }

  public async ensureDaemonRunning(): Promise<boolean> {
    try {
      const res = await fetch('http://127.0.0.1:19890/health', { signal: AbortSignal.timeout(1000) });
      if (res.ok) return true;
    } catch {}

    const bridgePath = resolveScriptPath('agent_s_bridge.py');
    const defaultVenvPython = 'D:\\AgenticOS\\runtimes\\agent-s\\.venv\\Scripts\\python.exe';
    const pythonExe = process.env.AGENT_S_PYTHON || (fs.existsSync(defaultVenvPython) ? defaultVenvPython : 'python');

    try {
      const proc = spawn(pythonExe, [bridgePath, '--daemon'], {
        detached: true,
        stdio: 'ignore',
      });
      proc.unref();

      const start = Date.now();
      while (Date.now() - start < 3500) {
        await new Promise(r => setTimeout(r, 200));
        try {
          const res = await fetch('http://127.0.0.1:19890/health', { signal: AbortSignal.timeout(500) });
          if (res.ok) {
            logger.info('[AgentSComputerUseProvider] Persistent Agent-S daemon started on port 19890.');
            return true;
          }
        } catch {}
      }
    } catch (e: any) {
      logger.warn('[AgentSComputerUseProvider] Failed to spawn persistent daemon:', e?.message);
    }
    return false;
  }

  /**
   * Executes a bounded GUI navigation goal using Agent-S3.
   *
   * Note: The returned result is a PROPOSAL from Agent-S.
   * AgenticOS SourceOutcomeVerifier must independently verify resulting desktop state.
   */
  public async executeGoal(request: ComputerUseGoalRequest): Promise<ComputerUseGoalResult> {
    const startTime = Date.now();
    const maxSteps = Math.min(request.maxSteps || 8, 20);
    const timeoutMs = Math.min(request.timeoutMs || 15000, 60000);

    logger.info('[AgentSComputerUseProvider] Starting bounded GUI goal execution:', {
      application: request.application,
      target: request.target,
      goal: request.goal,
      maxSteps,
      timeoutMs,
    });

    // 1. Mock Runner Hook (for deterministic automated tests and acceptance suites)
    if (this.mockRunner) {
      try {
        const result = await this.mockRunner(request);
        logger.info('[AgentSComputerUseProvider] Mock runner completed with status:', result.status);
        return result;
      } catch (err: any) {
        logger.error('[AgentSComputerUseProvider] Mock runner error:', err);
        return {
          status: 'FAILED',
          observations: [],
          actions: [],
          evidence: { error: err?.message || String(err) },
          durationMs: Date.now() - startTime,
          stepCount: 0,
          error: err?.message || String(err),
        };
      }
    }

    // 2. Real Python Bridge Execution
    const bridgePath = resolveScriptPath('agent_s_bridge.py');
    if (!fs.existsSync(bridgePath)) {
      const errMsg = `Agent-S3 bridge script not found at ${bridgePath}.`;
      logger.warn('[AgentSComputerUseProvider]', errMsg);
      return {
        status: 'FAILED',
        observations: [],
        actions: [],
        evidence: { error: errMsg, missingBridge: true },
        durationMs: Date.now() - startTime,
        stepCount: 0,
        error: errMsg,
      };
    }

    const payload = JSON.stringify({
      application: request.application,
      target: request.target,
      goal: request.goal,
      maxSteps,
      timeoutMs,
      windowHandle: request.windowHandle,
      windowBounds: request.windowBounds,
    });

    // 2. Persistent Daemon Execution (Fast Localhost HTTP, no Python re-initialization)
    const daemonOk = await this.ensureDaemonRunning();
    if (daemonOk) {
      try {
        const resp = await fetch('http://127.0.0.1:19890/execute_goal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          signal: AbortSignal.timeout(timeoutMs + 3000),
        });
        if (resp.ok) {
          const parsed = await resp.json() as any;
          logger.info('[AgentSComputerUseProvider] Persistent daemon returned result:', { status: parsed.status, steps: parsed.stepCount });
          return {
            status: parsed.status || 'SUCCESS',
            observations: parsed.observations || [],
            actions: parsed.actions || [],
            finalScreenshot: parsed.finalScreenshot,
            finalWindow: parsed.finalWindow,
            finalHwnd: parsed.finalHwnd,
            claimedTarget: parsed.claimedTarget || request.target,
            evidence: {
              ...parsed.evidence,
              groundingModel: 'bytedance/ui-tars-1.5-7b',
              agentSVersion: this.version,
              persistentDaemon: true,
              telemetry: parsed.telemetry || parsed.evidence?.telemetry,
              stopReason: parsed.evidence?.stopReason || parsed.error,
            },
            durationMs: Date.now() - startTime,
            stepCount: parsed.stepCount || (parsed.actions?.length ?? 1),
            error: parsed.error || parsed.evidence?.stopReason,
          };
        }
      } catch (err: any) {
        logger.warn('[AgentSComputerUseProvider] Daemon execution failed, falling back to CLI:', err?.message);
      }
    }

    try {
      const defaultVenvPython = 'D:\\AgenticOS\\runtimes\\agent-s\\.venv\\Scripts\\python.exe';
      const pythonExe = process.env.AGENT_S_PYTHON || (fs.existsSync(defaultVenvPython) ? defaultVenvPython : 'python');
      const cmd = `"${pythonExe}" "${bridgePath}" --payload ${Buffer.from(payload).toString('base64')}`;

      const { stdout, stderr } = await execAsync(cmd, {
        timeout: timeoutMs,
        maxBuffer: 20 * 1024 * 1024,
      });

      const firstBrace = stdout.indexOf('{');
      const lastBrace = stdout.lastIndexOf('}');
      if (firstBrace >= 0 && lastBrace > firstBrace) {
        const parsed = JSON.parse(stdout.substring(firstBrace, lastBrace + 1));
        return {
          status: parsed.status || 'SUCCESS',
          observations: parsed.observations || [],
          actions: parsed.actions || [],
          finalScreenshot: parsed.finalScreenshot,
          finalWindow: parsed.finalWindow,
          finalHwnd: parsed.finalHwnd,
          claimedTarget: parsed.claimedTarget || request.target,
          evidence: {
            ...parsed.evidence,
            groundingModel: 'bytedance/ui-tars-1.5-7b',
            agentSVersion: this.version,
            telemetry: parsed.telemetry || parsed.evidence?.telemetry,
            stopReason: parsed.evidence?.stopReason || parsed.error,
          },
          durationMs: Date.now() - startTime,
          stepCount: parsed.stepCount || (parsed.actions?.length ?? 1),
          error: parsed.error || parsed.evidence?.stopReason,
        };
      }

      throw new Error(`Invalid JSON output from Agent-S bridge: ${stdout.slice(0, 300)}`);
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      const isTimeout = durationMs >= timeoutMs || err?.killed || (err?.message && err.message.includes('TIMEDOUT'));
      const status = isTimeout ? 'TIMEOUT' : 'FAILED';

      logger.error('[AgentSComputerUseProvider] Bridge execution failed:', {
        status,
        durationMs,
        error: err?.message,
      });

      return {
        status,
        observations: [],
        actions: [],
        evidence: {
          error: err?.message || String(err),
          timedOut: isTimeout,
        },
        durationMs,
        stepCount: 0,
        error: err?.message || String(err),
      };
    }
  }

  /**
   * Generic Visual Read capability:
   * TargetIdentity + VisualReadQuery -> physical target capture -> UI-TARS interpretation -> AcquiredVisualContent
   */
  public async read(target: TargetIdentity, query: VisualReadQuery): Promise<AcquiredVisualContent> {
    const startTime = Date.now();

    logger.info('[AgentSComputerUseProvider] Starting target-bound visual read:', {
      targetId: target.targetId,
      hwnd: target.hwnd,
      application: target.application,
      contentType: query.contentType,
      count: query.count,
    });

    // 1. Validate Target Identity (Fail Closed immediately if no valid HWND)
    if (!target.hwnd || typeof target.hwnd !== 'number' || target.hwnd <= 0) {
      return {
        success: false,
        sourceTarget: target,
        methodUsed: 'UI_TARS_VISION',
        text: undefined,
        items: [],
        chatMessages: [],
        confidence: 0,
        evidenceArtifact: undefined,
        timestamp: Date.now(),
        error: `Invalid target identity: HWND must be a positive integer, got ${target.hwnd}`,
      };
    }

    // 2. Mock Runner Hook (for deterministic tests)
    if (this.mockReadRunner) {
      try {
        const result = await this.mockReadRunner(target, query);
        logger.info('[AgentSComputerUseProvider] Mock read runner completed with success:', result.success);
        return result;
      } catch (err: any) {
        logger.error('[AgentSComputerUseProvider] Mock read runner error:', err);
        return {
          success: false,
          sourceTarget: target,
          methodUsed: 'UI_TARS_VISION',
          confidence: 0,
          timestamp: Date.now(),
          error: err?.message || String(err),
        };
      }
    }

    const payload = JSON.stringify({
      targetId: target.targetId,
      hwnd: target.hwnd,
      pid: target.pid,
      processName: target.processName || target.process,
      application: target.application,
      windowBounds: target.bounds,
      subTarget: target.subTarget,
      readQuery: query,
      activateIfHidden: query.activateIfHidden ?? true,
      timestamp: startTime,
    });

    // 3. Persistent Daemon Execution
    const daemonOk = await this.ensureDaemonRunning();
    if (daemonOk) {
      try {
        const resp = await fetch('http://127.0.0.1:19890/read', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          signal: AbortSignal.timeout(35000),
        });
        if (resp.ok) {
          const parsed = (await resp.json()) as any;
          logger.info('[AgentSComputerUseProvider] Persistent daemon returned visual read result:', {
            success: parsed.success,
            methodUsed: parsed.methodUsed,
            messageCount: parsed.chatMessages?.length,
          });
          return {
            success: parsed.success === true,
            sourceTarget: {
              targetId: parsed.sourceTarget?.targetId || target.targetId,
              application: parsed.sourceTarget?.application || target.application,
              process: parsed.sourceTarget?.process || target.process,
              processName: parsed.sourceTarget?.processName || target.processName,
              hwnd: parsed.sourceTarget?.hwnd || target.hwnd,
              pid: parsed.sourceTarget?.pid || target.pid,
              bounds: parsed.sourceTarget?.bounds || target.bounds,
              subTarget: parsed.sourceTarget?.subTarget || target.subTarget,
            },
            methodUsed: 'UI_TARS_VISION',
            text: parsed.text,
            items: parsed.items || [],
            chatMessages: parsed.chatMessages || [],
            confidence: parsed.confidence ?? (parsed.success ? 0.95 : 0),
            evidenceArtifact: parsed.evidenceArtifact,
            timestamp: parsed.timestamp || Date.now(),
            durationMs: Date.now() - startTime,
            error: parsed.error,
          };
        }
      } catch (err: any) {
        logger.warn('[AgentSComputerUseProvider] Daemon read failed, falling back to CLI:', err?.message);
      }
    }

    // 4. CLI Fallback
    try {
      const bridgePath = resolveScriptPath('agent_s_bridge.py');
      const defaultVenvPython = 'D:\\AgenticOS\\runtimes\\agent-s\\.venv\\Scripts\\python.exe';
      const pythonExe = process.env.AGENT_S_PYTHON || (fs.existsSync(defaultVenvPython) ? defaultVenvPython : 'python');
      const cmd = `"${pythonExe}" "${bridgePath}" --read-payload ${Buffer.from(payload).toString('base64')}`;

      const { stdout } = await execAsync(cmd, {
        timeout: 35000,
        maxBuffer: 20 * 1024 * 1024,
      });

      const firstBrace = stdout.indexOf('{');
      const lastBrace = stdout.lastIndexOf('}');
      if (firstBrace >= 0 && lastBrace > firstBrace) {
        const parsed = JSON.parse(stdout.substring(firstBrace, lastBrace + 1));
        return {
          success: parsed.success === true,
          sourceTarget: {
            targetId: parsed.sourceTarget?.targetId || target.targetId,
            application: parsed.sourceTarget?.application || target.application,
            process: parsed.sourceTarget?.process || target.process,
            processName: parsed.sourceTarget?.processName || target.processName,
            hwnd: parsed.sourceTarget?.hwnd || target.hwnd,
            pid: parsed.sourceTarget?.pid || target.pid,
            bounds: parsed.sourceTarget?.bounds || target.bounds,
            subTarget: parsed.sourceTarget?.subTarget || target.subTarget,
          },
          methodUsed: 'UI_TARS_VISION',
          text: parsed.text,
          items: parsed.items || [],
          chatMessages: parsed.chatMessages || [],
          confidence: parsed.confidence ?? (parsed.success ? 0.95 : 0),
          evidenceArtifact: parsed.evidenceArtifact,
          timestamp: parsed.timestamp || Date.now(),
          durationMs: Date.now() - startTime,
          error: parsed.error,
        };
      }

      throw new Error(`Invalid JSON output from Agent-S read bridge: ${stdout.slice(0, 300)}`);
    } catch (err: any) {
      logger.error('[AgentSComputerUseProvider] Visual read CLI execution failed:', err);
      return {
        success: false,
        sourceTarget: target,
        methodUsed: 'UI_TARS_VISION',
        text: undefined,
        items: [],
        chatMessages: [],
        confidence: 0,
        timestamp: Date.now(),
        durationMs: Date.now() - startTime,
        error: err?.message || String(err),
      };
    }
  }
}

export const agentSComputerUseProvider = AgentSComputerUseProvider.getInstance();
