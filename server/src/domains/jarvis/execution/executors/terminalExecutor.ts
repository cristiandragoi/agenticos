/**
 * terminalExecutor.ts — First-class Terminal Executor for Universal Execution Controller.
 *
 * Supports:
 * - Direct execution via PowerShell (default on Windows), cmd, or bash
 * - cwd, environment variables, timeouts, maxBuffer
 * - Capturing stdout, stderr, exit code
 * - Process tracking, cancellation, and evidence logging
 * - Distinguishing background execution from visible window launch
 */

import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { logger } from '../../../../utils/logger.js';
import type { ActionPlanStep, ExecutionResult, VerificationResult, TurnContext } from '../types.js';

export interface TerminalRunOptions {
  command: string;
  cwd?: string;
  shell?: 'powershell' | 'cmd' | 'bash';
  timeoutMs?: number;
  env?: Record<string, string>;
  visibleWindow?: boolean;
}

export interface TerminalExecutionData {
  command: string;
  cwd: string;
  shell: string;
  pid?: number;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

export class TerminalExecutor {
  public readonly id = 'terminal';
  private activeProcesses = new Map<number, ChildProcess>();

  public async runCommand(opts: TerminalRunOptions): Promise<TerminalExecutionData> {
    const {
      command,
      cwd = process.cwd(),
      shell = 'powershell',
      timeoutMs = 60000,
      env = {},
      visibleWindow = false,
    } = opts;

    const t0 = Date.now();
    logger.info('[TerminalExecutor] Executing command:', { command, cwd, shell, visibleWindow, timeoutMs });

    // If visible window is explicitly requested, launch interactive window
    if (visibleWindow && process.platform === 'win32') {
      return new Promise<TerminalExecutionData>((resolve, reject) => {
        let shellExe = 'powershell.exe';
        let shellArgs = ['-NoExit', '-Command', `Set-Location "${cwd}"; ${command}`];

        if (shell === 'cmd') {
          shellExe = 'cmd.exe';
          shellArgs = ['/k', `cd /d "${cwd}" && ${command}`];
        }

        const child = spawn(shellExe, shellArgs, {
          detached: true,
          stdio: 'ignore',
          windowsHide: false,
          cwd,
        });
        child.unref();

        resolve({
          command,
          cwd,
          shell,
          pid: child.pid,
          exitCode: 0,
          stdout: `Launched visible ${shell} window for: ${command}`,
          stderr: '',
          durationMs: Date.now() - t0,
          timedOut: false,
        });
      });
    }

    // Otherwise, background programmatic execution capturing stdout/stderr/exitCode
    return new Promise<TerminalExecutionData>((resolve, reject) => {
      let procCmd: string;
      let procArgs: string[];

      if (process.platform === 'win32') {
        if (shell === 'cmd') {
          procCmd = 'cmd.exe';
          procArgs = ['/d', '/s', '/c', command];
        } else if (shell === 'bash') {
          procCmd = 'bash.exe';
          procArgs = ['-c', command];
        } else {
          procCmd = 'powershell.exe';
          procArgs = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command];
        }
      } else {
        procCmd = shell === 'bash' ? 'bash' : 'sh';
        procArgs = ['-c', command];
      }

      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const child = spawn(procCmd, procArgs, {
        cwd,
        env: { ...process.env, ...env },
        windowsHide: true,
      });

      if (child.pid) {
        this.activeProcesses.set(child.pid, child);
      }

      const timer = setTimeout(() => {
        timedOut = true;
        logger.warn('[TerminalExecutor] Command timed out, terminating:', { pid: child.pid, command });
        if (child.pid && process.platform === 'win32') {
          spawn('taskkill', ['/F', '/T', '/PID', String(child.pid)]).on('error', () => {});
        } else {
          child.kill('SIGTERM');
        }
      }, timeoutMs);

      child.stdout?.on('data', (d) => {
        const chunk = d.toString();
        stdout += chunk;
        if (stdout.length > 2 * 1024 * 1024) {
          stdout = stdout.slice(-1024 * 1024); // Cap max buffer
        }
      });

      child.stderr?.on('data', (d) => {
        const chunk = d.toString();
        stderr += chunk;
        if (stderr.length > 2 * 1024 * 1024) {
          stderr = stderr.slice(-1024 * 1024);
        }
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        if (child.pid) this.activeProcesses.delete(child.pid);

        const durationMs = Date.now() - t0;
        logger.info('[TerminalExecutor] Command finished:', {
          command,
          exitCode: code,
          durationMs,
          stdoutPreview: stdout.slice(0, 200).replace(/\r?\n/g, ' '),
        });

        resolve({
          command,
          cwd,
          shell,
          pid: child.pid,
          exitCode: code,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          durationMs,
          timedOut,
        });
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        if (child.pid) this.activeProcesses.delete(child.pid);
        reject(err);
      });
    });
  }

  public hasActiveProcesses(): boolean {
    return this.activeProcesses.size > 0;
  }

  public getActiveProcessCount(): number {
    return this.activeProcesses.size;
  }

  public cancelActiveProcesses(): void {
    logger.info(`[TerminalExecutor] Cancelling ${this.activeProcesses.size} active child processes.`);
    for (const [pid, proc] of this.activeProcesses) {
      try {
        if (!proc.killed) proc.kill('SIGKILL');
      } catch (err) {
        logger.warn(`[TerminalExecutor] Failed to kill process ${pid}:`, err);
      }
    }
    this.activeProcesses.clear();
  }

  public sanitizeTerminalError(stderr: string, stdout: string, exitCode: number | null): string {
    const raw = (stderr || stdout || '').trim();
    if (!raw) {
      return `The command failed with exit code ${exitCode ?? 1}.`;
    }

    const lower = raw.toLowerCase();
    if (
      lower.includes('parsererror') ||
      lower.includes('parentcontainserrorrecordexception') ||
      lower.includes('commandnotfoundexception') ||
      lower.includes('wurde nicht als name eines cmdlet') ||
      lower.includes('is not recognized as the name of a cmdlet') ||
      (lower.includes('the term') && lower.includes('is not recognized'))
    ) {
      return 'The command failed because PowerShell could not parse it.';
    }

    if (lower.includes('cannot find path') || lower.includes('pfad kann nicht gefunden werden')) {
      return 'The command failed because the specified path does not exist.';
    }

    if (lower.includes('permissiondenied') || lower.includes('zugriff verweigert') || lower.includes('access is denied')) {
      return 'The command failed due to permission denied.';
    }

    if (lower.includes('timed out') || lower.includes('timeout')) {
      return 'The command timed out before completion.';
    }

    // Default clean natural speech without technical stack traces or JSON
    return `The terminal command failed with exit code ${exitCode ?? 1}.`;
  }

  public async executeStep(step: ActionPlanStep, context: TurnContext): Promise<ExecutionResult> {
    const command = (step.parameters.command as string) || '';
    const cwd = (step.parameters.cwd as string) || context.workspacePath || process.cwd();
    const shell = (step.parameters.shell as any) || 'powershell';
    const timeoutMs = (step.parameters.timeoutMs as number) || 60000;
    const visibleWindow = Boolean(step.parameters.visibleWindow);

    try {
      const data = await this.runCommand({ command, cwd, shell, timeoutMs, visibleWindow });
      const success = data.exitCode === 0;
      const cleanError = success ? undefined : this.sanitizeTerminalError(data.stderr, data.stdout, data.exitCode);

      return {
        stepId: step.stepId,
        success,
        data,
        output: success ? (data.stdout || 'Command completed.') : cleanError,
        error: cleanError,
        evidence: {
          command: data.command,
          cwd: data.cwd,
          pid: data.pid,
          exitCode: data.exitCode,
          durationMs: data.durationMs,
          rawStderr: data.stderr,
          rawStdout: data.stdout,
        },
      };
    } catch (err: any) {
      return {
        stepId: step.stepId,
        success: false,
        error: `Terminal execution failed: ${err?.message || String(err)}`,
      };
    }
  }

  public async verify(result: ExecutionResult): Promise<VerificationResult> {
    const data = result.data as TerminalExecutionData | undefined;
    if (!data) {
      return {
        verified: false,
        realityCheck: 'No terminal execution data returned',
        error: result.error || 'Execution failed without process data',
      };
    }

    const verified = data.exitCode === 0;
    return {
      verified,
      realityCheck: `Command "${data.command}" exited with code ${data.exitCode} in ${data.durationMs}ms`,
      actualState: {
        exitCode: data.exitCode,
        stdoutLength: data.stdout.length,
        stderrLength: data.stderr.length,
        cwd: data.cwd,
      },
      error: verified ? undefined : `Command failed (code ${data.exitCode})`,
    };
  }
}

export const terminalExecutor = new TerminalExecutor();
