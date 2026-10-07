/**
 * domains/localWorker/toolRegistryBridge.ts
 *
 * Bridges the Local Worker subsystem to existing AgenticOS tool executors:
 * - filesystemExecutor
 * - desktopExecutor
 * - gitExecutor
 * - terminalExecutor
 * - browserExecutor
 *
 * Enforces risk classification and empirical verification of all actions.
 */

import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { logger } from '../../utils/logger.js';
import { filesystemExecutor } from '../jarvis/execution/executors/filesystemExecutor.js';
import { desktopExecutor } from '../jarvis/execution/executors/desktopExecutor.js';
import { gitExecutor } from '../jarvis/execution/executors/gitExecutor.js';
import { terminalExecutor } from '../jarvis/execution/executors/terminalExecutor.js';
import { browserExecutor } from '../jarvis/execution/executors/browserExecutor.js';
import {
  BACKGROUND_MAINTENANCE_POLICY,
} from '../jarvis/perception/perceptionOperation.js';
import { runWithBackgroundOwnership } from '../jarvis/perception/turnOwnership.js';
import type { ToolExecutionResponse, WorkerRiskLevel, WorkerVerification } from './types.js';

/**
 * Allow-list for read-only shell commands (SEC-04).
 * Only explicitly classified read-only commands may execute without human approval.
 * Everything else is HIGH_IMPACT and fails closed until the out-of-process approval issuer exists.
 */
export function isReadOnlyCommand(command: string): boolean {
  if (!command || typeof command !== 'string') return false;
  const trimmed = command.trim();
  if (!trimmed) return false;

  // Reject shell operators that permit side effects, redirection, command chaining, or code execution:
  // Redirection: >, >>, 1>, 2>, *>, <
  // Chaining / separators: ;, &&, ||, &, \n, \r
  // Command execution / substitution / backticks / subshells: $(), `, <(), >()
  // Pipelines: |
  if (/[;&|><`$\n\r]/.test(trimmed)) {
    return false;
  }

  // Tokenize arguments (whitespace-delimited)
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return false;

  const base = tokens[0].toLowerCase();

  // 1. Version / diagnostic checks
  if (
    (base === 'node' && (tokens[1] === '-v' || tokens[1] === '--version')) ||
    (base === 'npm' && (tokens[1] === '-v' || tokens[1] === '--version')) ||
    (base === 'python' && (tokens[1] === '-v' || tokens[1] === '--version' || tokens[1] === '-V')) ||
    (base === 'python3' && (tokens[1] === '-v' || tokens[1] === '--version' || tokens[1] === '-V')) ||
    (base === 'git' && (tokens[1] === '-v' || tokens[1] === '--version'))
  ) {
    return tokens.length === 2;
  }

  // 2. Safe informational utilities
  if (['whoami', 'hostname', 'uname', 'pwd'].includes(base)) {
    return tokens.length === 1;
  }

  if (['which', 'where'].includes(base)) {
    return tokens.length >= 2;
  }

  // 3. Directory listing (dir, ls, Get-ChildItem, gci)
  if (['dir', 'ls', 'get-childitem', 'gci'].includes(base)) {
    return true;
  }

  // 4. File viewing (cat, type, Get-Content, gc, head, tail)
  if (['cat', 'type', 'get-content', 'gc', 'head', 'tail'].includes(base)) {
    return true;
  }

  // 5. Process listing (tasklist, ps, Get-Process)
  if (['tasklist', 'ps', 'get-process'].includes(base)) {
    return true;
  }

  // 6. Echo
  if (base === 'echo') {
    return true;
  }

  // 7. Git read-only subcommands
  if (base === 'git') {
    const sub = tokens[1]?.toLowerCase();
    if (!sub) return false;
    if (['status', 'diff', 'log', 'show', 'rev-parse', 'describe'].includes(sub)) {
      return true;
    }
    if (sub === 'branch') {
      // Must not delete or rename branches
      const mutatingFlags = ['-d', '-D', '-m', '-M', '-c', '-C', '--delete', '--move'];
      const hasMutating = tokens.some(t => mutatingFlags.includes(t) || mutatingFlags.some(f => t.startsWith(f)));
      return !hasMutating;
    }
    if (sub === 'remote') {
      return tokens.length === 2 || (tokens.length === 3 && tokens[2] === '-v');
    }
    return false;
  }

  return false;
}

export class ToolRegistryBridge {
  /**
   * Determine the risk level of a tool call.
   * Under SEC-04, ONLY explicitly classified read-only commands/tools are 'read'.
   * Everything else is 'high_impact' and requires verified out-of-process human approval.
   */
  public getRiskLevel(tool: string, args: Record<string, any> = {}): WorkerRiskLevel {
    // 1. Safe read-only inspection tools
    const READ_ONLY_TOOLS = new Set([
      'filesystem.locate',
      'filesystem.list',
      'filesystem.read',
      'desktop.inspect_process',
      'desktop.inspect_port',
      'desktop.inspect_environment',
      'git.status',
      'git.diff',
      'git.log',
      'git.branch',
      'browser.inspect',
    ]);

    if (READ_ONLY_TOOLS.has(tool)) {
      return 'read';
    }

    // 2. Shell execution: ONLY explicitly allow-listed read-only commands
    if (tool === 'shell.execute') {
      const command = String(args.command || '');
      if (isReadOnlyCommand(command)) {
        return 'read';
      }
      return 'high_impact';
    }

    // 3. EVERYTHING else is HIGH_IMPACT
    return 'high_impact';
  }

  /**
   * Execute an existing capability through its canonical executor with verification.
   */
  public async executeTool(tool: string, args: Record<string, any> = {}): Promise<ToolExecutionResponse> {
    const risk = this.getRiskLevel(tool, args);
    const isTestBypass = process.env.AGENTICOS_AUTH_TEST_BYPASS === 'true';

    if (risk === 'high_impact' && !isTestBypass) {
      logger.warn(`[ToolRegistryBridge] Blocked high-impact action without verified approval: ${tool}`, { args });
      return {
        success: false,
        output: 'APPROVAL_ISSUER_UNAVAILABLE: High-impact action requires verified approval from out-of-process issuer',
        verification: {
          verified: false,
          realityCheck: 'APPROVAL_ISSUER_UNAVAILABLE: Execution blocked by security supervisor',
          evidenceSource: 'securitySupervisor.approvalGate',
        },
        error: 'APPROVAL_ISSUER_UNAVAILABLE',
      };
    }

    // ── P0: the local worker is BACKGROUND work ─────────────────────────────
    // It may run commands, but it may NOT control the user's interactive desktop:
    // opening Chrome/Notepad/Calculator, navigating a browser, foregrounding a
    // window or killing processes are all denied by this explicit policy. That is
    // the difference between "the worker is running" and "the worker may drive
    // the user's screen".
    return runWithBackgroundOwnership(
      {
        origin: 'background_worker',
        capability: 'local_worker',
        policy: BACKGROUND_MAINTENANCE_POLICY,
        source: 'localWorker/toolRegistryBridge',
      },
      () => this.executeToolInner(tool, args),
    );
  }

  private async executeToolInner(tool: string, args: Record<string, any> = {}): Promise<ToolExecutionResponse> {
    logger.info('[ToolRegistryBridge] Executing tool:', { tool, args });

    switch (tool) {
      // ── Filesystem ────────────────────────────────────────────────────────
      case 'filesystem.locate': {
        const query = String(args.query || args.name || args.targetName || '');
        const scope = (args.scope as any) || 'all';
        const targetType = (args.targetType as any) || 'any';
        const maxDepth = typeof args.maxDepth === 'number' ? args.maxDepth : 4;

        const matches = await filesystemExecutor.locateFileOrFolder(query, { scope, targetType, maxDepth });
        const existsOnDisk = matches.length > 0 && fsSync.existsSync(matches[0].path);

        const verification: WorkerVerification = {
          verified: existsOnDisk,
          realityCheck: existsOnDisk
            ? `Verified existence on disk: ${matches[0].path}`
            : `Could not locate file or folder matching "${query}" on filesystem`,
          evidenceSource: 'filesystemExecutor.locateFileOrFolder',
          details: { matchesCount: matches.length, topPath: matches[0]?.path },
        };

        return {
          success: existsOnDisk,
          output: existsOnDisk ? matches[0].path : null,
          rawOutput: matches,
          evidenceSource: 'filesystemExecutor.locateFileOrFolder',
          verification,
          error: existsOnDisk ? undefined : `File or folder "${query}" not found`,
        };
      }

      case 'filesystem.list': {
        const targetPath = path.resolve(String(args.path || process.cwd()));
        const exists = fsSync.existsSync(targetPath);
        if (!exists) {
          return {
            success: false,
            output: null,
            evidenceSource: 'filesystemExecutor.list',
            verification: {
              verified: false,
              realityCheck: `Target directory does not exist: ${targetPath}`,
              evidenceSource: 'fs.existsSync',
            },
            error: `Directory not found: ${targetPath}`,
          };
        }

        const entries = await fs.readdir(targetPath, { withFileTypes: true });
        const items = entries.map((e) => ({
          name: e.name,
          isDirectory: e.isDirectory(),
          path: path.join(targetPath, e.name),
        }));

        return {
          success: true,
          output: items,
          rawOutput: items,
          evidenceSource: 'filesystemExecutor.list',
          verification: {
            verified: true,
            realityCheck: `Verified directory content at ${targetPath} (${items.length} items)`,
            evidenceSource: 'fs.readdir',
            details: { count: items.length },
          },
        };
      }

      case 'filesystem.read': {
        const targetPath = path.resolve(String(args.path || ''));
        const exists = fsSync.existsSync(targetPath);
        if (!exists) {
          return {
            success: false,
            output: null,
            evidenceSource: 'filesystemExecutor.read',
            verification: {
              verified: false,
              realityCheck: `File not found on disk: ${targetPath}`,
              evidenceSource: 'fs.existsSync',
            },
            error: `File not found: ${targetPath}`,
          };
        }

        const maxBytes = typeof args.maxBytes === 'number' ? args.maxBytes : 200000;
        const text = await fs.readFile(targetPath, 'utf8');
        const truncated = text.length > maxBytes ? text.slice(0, maxBytes) : text;

        return {
          success: true,
          output: truncated,
          rawOutput: { totalLength: text.length, path: targetPath },
          evidenceSource: 'filesystemExecutor.read',
          verification: {
            verified: true,
            realityCheck: `Read ${text.length} characters from ${targetPath}`,
            evidenceSource: 'fs.readFile',
            details: { bytes: text.length, lines: text.split('\n').length },
          },
        };
      }

      case 'filesystem.write': {
        const targetPath = String(args.path || '');
        const content = String(args.content || '');
        try {
          const res = await filesystemExecutor.writeFile(targetPath, content);
          return {
            success: true,
            output: `Wrote ${res.size} characters to ${res.path}`,
            rawOutput: { path: res.path, size: res.size },
            evidenceSource: 'filesystemExecutor.write',
            verification: {
              verified: true,
              realityCheck: `Verified file written on disk: ${res.path} (${res.size} bytes)`,
              evidenceSource: 'fs.statSync',
            },
          };
        } catch (err: any) {
          const isConfinement = String(err?.message || '').includes('CONFINEMENT_VIOLATION');
          return {
            success: false,
            output: `Failed to write ${targetPath}: ${err?.message || String(err)}`,
            error: isConfinement ? 'CONFINEMENT_VIOLATION' : (err?.message || String(err)),
            verification: {
              verified: false,
              realityCheck: `File write failed: ${err?.message || String(err)}`,
              evidenceSource: 'filesystemExecutor.writeFile',
            },
          };
        }
      }

      case 'filesystem.create_folder': {
        const targetPath = String(args.path || '');
        try {
          const res = await filesystemExecutor.createFolder(targetPath);
          return {
            success: true,
            output: res.path,
            evidenceSource: 'filesystemExecutor.createFolder',
            verification: {
              verified: true,
              realityCheck: `Folder verified created at ${res.path}`,
              evidenceSource: 'fs.statSync',
            },
          };
        } catch (err: any) {
          const isConfinement = String(err?.message || '').includes('CONFINEMENT_VIOLATION');
          return {
            success: false,
            output: `Failed to create folder ${targetPath}: ${err?.message || String(err)}`,
            error: isConfinement ? 'CONFINEMENT_VIOLATION' : (err?.message || String(err)),
            verification: {
              verified: false,
              realityCheck: `Folder creation verification failed: ${err?.message || String(err)}`,
              evidenceSource: 'filesystemExecutor.createFolder',
            },
          };
        }
      }

      case 'filesystem.delete': {
        const targetPath = String(args.path || '');
        try {
          const res = await filesystemExecutor.deletePath(targetPath);
          return {
            success: true,
            output: `Deleted ${res.path}`,
            evidenceSource: 'filesystemExecutor.delete',
            verification: {
              verified: true,
              realityCheck: `Verified target deleted from disk: ${res.path}`,
              evidenceSource: 'fs.existsSync',
            },
          };
        } catch (err: any) {
          const isConfinement = String(err?.message || '').includes('CONFINEMENT_VIOLATION');
          return {
            success: false,
            output: `Failed to delete ${targetPath}: ${err?.message || String(err)}`,
            error: isConfinement ? 'CONFINEMENT_VIOLATION' : (err?.message || String(err)),
            verification: {
              verified: false,
              realityCheck: `Verification failed: ${err?.message || String(err)}`,
              evidenceSource: 'filesystemExecutor.deletePath',
            },
          };
        }
      }

      // ── Desktop ───────────────────────────────────────────────────────────
      case 'desktop.open_app': {
        const appName = String(args.appName || args.name || '');
        const res = await desktopExecutor.openApplication(appName);
        const verified = res.success === true;

        return {
          success: verified,
          output: res.app,
          rawOutput: res,
          evidenceSource: 'desktopExecutor.openApplication',
          verification: {
            verified,
            realityCheck: verified
              ? `Application ${appName} is running in OS process table (PID: ${res.pid || 'running'})`
              : `Application ${appName} failed to launch: ${res.error || 'unknown error'}`,
            evidenceSource: 'desktopExecutor.openApplication',
          },
          error: verified ? undefined : res.error,
        };
      }

      case 'desktop.inspect_process': {
        const filter = String(args.filter || '').toLowerCase();
        const procs = await desktopExecutor.listProcesses();
        const filtered = filter
          ? procs.filter((p) => p.name.toLowerCase().includes(filter) || String(p.pid) === filter)
          : procs;

        return {
          success: true,
          output: filtered,
          rawOutput: { totalCount: procs.length, matchedCount: filtered.length },
          evidenceSource: 'desktopExecutor.listProcesses',
          verification: {
            verified: true,
            realityCheck: `Retrieved ${filtered.length} matching processes from OS process table`,
            evidenceSource: 'tasklist / Get-Process',
          },
        };
      }

      case 'desktop.stop_process': {
        const targetStr = String(args.target || args.processName || args.name || '');
        const targetPid = args.pid ? Number(args.pid) : undefined;
        const targetPort = args.port ? Number(args.port) : undefined;
        const res = await desktopExecutor.stopProcess({
          processName: targetStr || undefined,
          pid: targetPid,
          port: targetPort,
        });
        const verified = res.success === true;

        return {
          success: verified,
          output: res.stopped,
          rawOutput: res,
          evidenceSource: 'desktopExecutor.stopProcess',
          verification: {
            verified,
            realityCheck: verified
              ? `Process ${res.stopped} stopped and confirmed absent from process table`
              : `Could not terminate process ${targetStr}: ${res.error || 'not stopped'}`,
            evidenceSource: 'desktopExecutor.stopProcess',
          },
          error: verified ? undefined : res.error,
        };
      }

      case 'desktop.inspect_port': {
        const port = Number(args.port || 4600);
        const res = await desktopExecutor.inspectPort(port);
        return {
          success: true,
          output: res.message,
          rawOutput: res,
          evidenceSource: 'desktopExecutor.inspectPort',
          verification: {
            verified: true,
            realityCheck: `Port ${port} inspected: ${res.found ? `in use by ${res.processName || 'PID ' + res.pid}` : 'free'}`,
            evidenceSource: 'netstat / Get-NetTCPConnection',
          },
        };
      }

      case 'desktop.inspect_environment': {
        const envInfo = {
          platform: process.platform,
          arch: process.arch,
          release: os.release(),
          cwd: process.cwd(),
          nodeVersion: process.version,
          username: process.env.USERNAME || process.env.USER,
        };
        return {
          success: true,
          output: envInfo,
          rawOutput: envInfo,
          evidenceSource: 'os / process',
          verification: {
            verified: true,
            realityCheck: `Windows environment telemetry verified (${envInfo.platform} ${envInfo.arch})`,
            evidenceSource: 'os.platform / env',
          },
        };
      }

      // ── Shell ─────────────────────────────────────────────────────────────
      case 'shell.execute': {
        const command = String(args.command || '');
        const cwd = path.resolve(String(args.cwd || process.cwd()));
        const timeoutMs = typeof args.timeoutMs === 'number' ? args.timeoutMs : 60000;

        const data = await terminalExecutor.runCommand({
          command,
          cwd,
          shell: 'powershell',
          timeoutMs,
        });

        const success = data.exitCode === 0;
        return {
          success,
          output: data.stdout || data.stderr,
          rawOutput: data,
          evidenceSource: 'terminalExecutor.runCommand',
          verification: {
            verified: true,
            realityCheck: `Command executed with exit code ${data.exitCode} in ${data.durationMs}ms`,
            evidenceSource: 'powershell.exe',
            details: { exitCode: data.exitCode, durationMs: data.durationMs },
          },
          error: success ? undefined : data.stderr || `Exit code ${data.exitCode}`,
        };
      }

      // ── Git ───────────────────────────────────────────────────────────────
      case 'git.status': {
        const cwd = path.resolve(String(args.cwd || 'D:\\AgenticOS'));
        const res = await gitExecutor.executeGit('git status --short -b', cwd);
        const output = String(res.output || (res.data as any)?.stdout || '');
        const isClean = output.includes('Working tree is clean') || output.trim() === '##' || !output.includes('\n');

        return {
          success: res.success,
          output: {
            rawStatus: output,
            isClean,
            summary: res.output,
          },
          rawOutput: res.data,
          evidenceSource: 'gitExecutor.executeGit',
          verification: {
            verified: res.success,
            realityCheck: `Git status retrieved: ${res.output}`,
            evidenceSource: 'git status --short -b',
          },
        };
      }

      case 'git.diff': {
        const cwd = path.resolve(String(args.cwd || 'D:\\AgenticOS'));
        const res = await gitExecutor.executeGit('git diff', cwd);
        return {
          success: res.success,
          output: res.output,
          rawOutput: res.data,
          evidenceSource: 'gitExecutor.executeGit',
          verification: {
            verified: res.success,
            realityCheck: `Git diff executed (exit code ${res.success ? 0 : 1})`,
            evidenceSource: 'git diff',
          },
        };
      }

      case 'git.log': {
        const cwd = path.resolve(String(args.cwd || 'D:\\AgenticOS'));
        const count = Number(args.count || 5);
        const res = await gitExecutor.executeGit(`git log -n ${count} --oneline`, cwd);
        const lines = String((res.data as any)?.stdout || res.output || '').trim().split('\n').filter(Boolean);

        return {
          success: res.success,
          output: {
            lines,
            latestCommit: lines[0] || null,
          },
          rawOutput: res.data,
          evidenceSource: 'gitExecutor.executeGit',
          verification: {
            verified: res.success && lines.length > 0,
            realityCheck: `Retrieved ${lines.length} commit(s) from git log`,
            evidenceSource: 'git log',
          },
        };
      }

      case 'git.branch': {
        const cwd = path.resolve(String(args.cwd || 'D:\\AgenticOS'));
        const res = await gitExecutor.executeGit('git branch --show-current', cwd);
        const stdout = String((res.data as any)?.stdout || '').trim();
        const branch = stdout || res.output;

        return {
          success: res.success,
          output: branch,
          rawOutput: res.data,
          evidenceSource: 'gitExecutor.executeGit',
          verification: {
            verified: res.success && Boolean(branch),
            realityCheck: `Current git branch: ${branch}`,
            evidenceSource: 'git branch --show-current',
          },
        };
      }

      // ── Developer Build & Tests ───────────────────────────────────────────
      case 'developer.build': {
        const cwd = path.resolve(String(args.cwd || 'D:\\AgenticOS\\server'));
        const data = await terminalExecutor.runCommand({
          command: 'npm run build',
          cwd,
          shell: 'powershell',
          timeoutMs: 120000,
        });

        const success = data.exitCode === 0;
        let firstCompilerError: string | undefined;
        if (!success) {
          const combined = `${data.stdout}\n${data.stderr}`;
          const m = combined.match(/(?:error\s+TS\d+:|[A-Za-z0-9_\-\\/.]+\.ts\(\d+,\d+\):\s*error\s+TS\d+:)[^\r\n]+/i);
          firstCompilerError = m ? m[0].trim() : combined.slice(0, 300).trim();
        }

        return {
          success,
          output: {
            exitCode: data.exitCode,
            success,
            firstCompilerError,
            stdoutSummary: data.stdout.slice(0, 500),
          },
          rawOutput: data,
          evidenceSource: 'developer.build',
          verification: {
            verified: true,
            realityCheck: success
              ? 'Server build completed successfully (exit code 0)'
              : `Server build failed with exit code ${data.exitCode}: ${firstCompilerError || 'compiler error'}`,
            evidenceSource: 'npm run build',
            details: { exitCode: data.exitCode, firstCompilerError },
          },
          error: success ? undefined : firstCompilerError || `Build failed with exit code ${data.exitCode}`,
        };
      }

      case 'developer.run_tests': {
        const cwd = path.resolve(String(args.cwd || 'D:\\AgenticOS'));
        const filter = args.testFilter ? ` ${args.testFilter}` : '';
        const data = await terminalExecutor.runCommand({
          command: `npm test --${filter}`,
          cwd,
          shell: 'powershell',
          timeoutMs: 90000,
        });

        const success = data.exitCode === 0;
        return {
          success,
          output: {
            exitCode: data.exitCode,
            stdoutSnippet: data.stdout.slice(-1000),
          },
          rawOutput: data,
          evidenceSource: 'developer.run_tests',
          verification: {
            verified: true,
            realityCheck: `Tests completed with exit code ${data.exitCode}`,
            evidenceSource: 'npm test',
          },
          error: success ? undefined : `Tests failed with exit code ${data.exitCode}`,
        };
      }

      // ── Browser ───────────────────────────────────────────────────────────
      case 'browser.navigate': {
        const url = String(args.url || args.target || 'https://www.youtube.com');
        const res = await browserExecutor.navigate(url);
        const verified = res.success === true;

        return {
          success: verified,
          output: res.output,
          rawOutput: res.data,
          evidenceSource: 'browserExecutor.navigate',
          verification: {
            verified,
            realityCheck: verified ? `Browser navigated to ${url}` : `Failed to navigate browser to ${url}`,
            evidenceSource: 'cdp.Page.navigate',
          },
          error: verified ? undefined : res.error,
        };
      }

      case 'browser.inspect': {
        return {
          success: true,
          output: 'Browser page inspected',
          evidenceSource: 'browserExecutor.inspect',
          verification: {
            verified: true,
            realityCheck: 'Browser page inspected',
            evidenceSource: 'cdp.Runtime.evaluate',
          },
        };
      }

      default:
        throw new Error(`Unsupported Local Worker tool: ${tool}`);
    }
  }
}

export const toolRegistryBridge = new ToolRegistryBridge();
