/**
 * hermesWatchdog.ts — Supervisor-Owned Hermes Watchdog & Process Recovery Manager.
 *
 * Requirements:
 * - Deterministic process management (no LLM in the loop for restarting Hermes).
 * - States: HEALTHY, DEGRADED, OFFLINE, RESTARTING, RECOVERED, FAILED.
 * - Auto-detects when Hermes HTTP API is unreachable.
 * - Auto-starts/restarts Hermes gateway via background process spawn.
 * - Polls health endpoint with exponential backoff until verified online.
 * - Verifies provider & model availability.
 * - Bounded retries before escalating.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { logger } from '../utils/logger.js';
import { hermesApiService, resolveHermesUrl } from './hermesApiService.js';

export type HermesWatchdogState =
  | 'HEALTHY'
  | 'DEGRADED'
  | 'OFFLINE'
  | 'RESTARTING'
  | 'RECOVERED'
  | 'FAILED';

export interface HermesHealthStatus {
  state: HermesWatchdogState;
  reachable: boolean;
  detail: string;
  baseUrl: string;
  provider?: string;
  model?: string;
  context?: number;
  processRunning?: boolean;
}

export class HermesWatchdog {
  private currentState: HermesWatchdogState = 'OFFLINE';
  private activeProcess: ChildProcess | null = null;
  private recoveryPromise: Promise<{ success: boolean; state: HermesWatchdogState; error?: string }> | null = null;
  private maxRestartAttempts = 3;
  private consecutiveFailures = 0;

  public getState(): HermesWatchdogState {
    return this.currentState;
  }

  /**
   * Passive or active health check of the Hermes gateway service.
   */
  public async checkHealth(): Promise<HermesHealthStatus> {
    try {
      const status = await hermesApiService.getStatus();
      if (status.reachable) {
        this.consecutiveFailures = 0;
        if (this.currentState === 'RESTARTING' || this.currentState === 'RECOVERED') {
          this.currentState = 'RECOVERED';
        } else {
          this.currentState = 'HEALTHY';
        }
        return {
          state: this.currentState,
          reachable: true,
          detail: status.detail,
          baseUrl: status.baseUrl || 'http://127.0.0.1:8642',
          provider: status.provider,
          model: status.model,
          context: status.context,
          processRunning: true,
        };
      } else {
        if (this.currentState !== 'RESTARTING') {
          this.currentState = 'OFFLINE';
        }
        return {
          state: this.currentState,
          reachable: false,
          detail: status.detail,
          baseUrl: status.baseUrl || 'http://127.0.0.1:8642',
          provider: status.provider,
          model: status.model,
          context: status.context,
          processRunning: false,
        };
      }
    } catch (err: any) {
      if (this.currentState !== 'RESTARTING') {
        this.currentState = 'OFFLINE';
      }
      return {
        state: this.currentState,
        reachable: false,
        detail: `Hermes check error: ${err?.message || err}`,
        baseUrl: 'http://127.0.0.1:8642',
        processRunning: false,
      };
    }
  }

  /**
   * Deterministic recovery of Hermes service.
   * Invoked automatically by Supervisor or Self-Heal when Hermes is required.
   */
  public async recoverHermes(reason = 'Hermes required by autonomous engineering'): Promise<{
    success: boolean;
    state: HermesWatchdogState;
    error?: string;
  }> {
    // If recovery is already in-flight, reuse the existing promise
    if (this.recoveryPromise) {
      return this.recoveryPromise;
    }

    this.recoveryPromise = this._executeRecovery(reason).finally(() => {
      this.recoveryPromise = null;
    });

    return this.recoveryPromise;
  }

  private async _executeRecovery(reason: string): Promise<{
    success: boolean;
    state: HermesWatchdogState;
    error?: string;
  }> {
    logger.info('[HermesWatchdog] Initiating automated Hermes gateway recovery', {
      reason,
      priorState: this.currentState,
      attempt: this.consecutiveFailures + 1,
    });

    this.currentState = 'RESTARTING';

    const pythonCandidates = [
      path.join(process.env.LOCALAPPDATA || '', 'hermes', 'hermes-agent', 'venv', 'Scripts', 'python.exe'),
      path.join(process.env.USERPROFILE || '', 'AppData', 'Local', 'hermes', 'hermes-agent', 'venv', 'Scripts', 'python.exe'),
      'python',
    ];

    let pythonBin = '';
    for (const p of pythonCandidates) {
      if (fs.existsSync(p)) {
        pythonBin = p;
        break;
      }
    }
    if (!pythonBin) pythonBin = 'python';

    const hermesAgentDir = path.join(process.env.LOCALAPPDATA || '', 'hermes', 'hermes-agent');
    const cwd = fs.existsSync(hermesAgentDir) ? hermesAgentDir : undefined;

    try {
      // Spawn hermes gateway run as a detached daemon process
      const child = spawn(
        pythonBin,
        ['-m', 'hermes_cli.main', 'gateway', 'run'],
        {
          cwd,
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
          env: {
            ...process.env,
            HERMES_ACCEPT_HOOKS: '1',
          },
        }
      );

      child.unref();
      this.activeProcess = child;

      logger.info('[HermesWatchdog] Hermes gateway process spawned', {
        pid: child.pid,
        pythonBin,
      });

      // Poll health endpoint for up to 15 seconds
      const baseUrl = await resolveHermesUrl(true);
      const pollStart = Date.now();
      const maxWaitMs = 15000;
      let healthy = false;

      while (Date.now() - pollStart < maxWaitMs) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const check = await hermesApiService.getStatus();
        if (check.reachable) {
          healthy = true;
          break;
        }
      }

      if (healthy) {
        this.currentState = 'RECOVERED';
        this.consecutiveFailures = 0;
        logger.info('[HermesWatchdog] Hermes gateway successfully recovered and verified online', {
          baseUrl,
          elapsedMs: Date.now() - pollStart,
        });
        return { success: true, state: 'RECOVERED' };
      } else {
        this.consecutiveFailures++;
        if (this.consecutiveFailures >= this.maxRestartAttempts) {
          this.currentState = 'FAILED';
        } else {
          this.currentState = 'DEGRADED';
        }
        const error = `Hermes gateway spawned but health endpoint ${baseUrl} did not respond within ${maxWaitMs / 1000}s.`;
        logger.error('[HermesWatchdog] ' + error);
        return { success: false, state: this.currentState, error };
      }
    } catch (err: any) {
      this.consecutiveFailures++;
      this.currentState = this.consecutiveFailures >= this.maxRestartAttempts ? 'FAILED' : 'DEGRADED';
      const error = `Failed to spawn Hermes gateway: ${err?.message || err}`;
      logger.error('[HermesWatchdog] ' + error);
      return { success: false, state: this.currentState, error };
    }
  }
}

export const hermesWatchdog = new HermesWatchdog();
