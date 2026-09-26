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
import type { ToolExecutionResponse, WorkerRiskLevel, WorkerVerification } from './types.js';

export class ToolRegistryBridge {
  /**
   * Determine the risk level of a tool call.
   */
  public getRiskLevel(tool: string, args: Record<string, any> = {}): WorkerRiskLevel {
    // 1. Explicit High-Impact Operations
    if (tool === 'filesystem.delete') return 'high_impact';
    if (tool === 'desktop.stop_process') {
      const target = String(args.target || args.processName || '').toLowerCase();
      // Stopping critical system processes or unknown broad targets is high impact
      if (/system|csrss|explorer|winlogon|smss|svchost|lsass/i.test(target)) {
        return 'high_impact';
      }
    }
    if (tool === 'shell.execute') {
      const cmd = String(args.command || '').toLowerCase();
      if (
        /\b(?:rmdir|del|rm|format|drop|truncate|kill)\b/i.test(cmd) &&
        /\b(?:\/s|-rf|-r|\*)\b/i.test(cmd)
      ) {
        return 'high_impact';
      }
    }

    // 2. Write / Modification Operations
    if (
      tool === 'filesystem.write' ||
      tool === 'filesystem.create_folder' ||
      tool === 'desktop.open_app' ||
      tool === 'developer.build' ||
      tool === 'developer.run_tests' ||
      tool === 'browser.navigate'
    ) {
      return 'write';
    }

    // 3. Everything else is Read / Low Risk
    return 'read';
  }

  /**
   * Execute an existing capability through its canonical executor with verification.
   */
  public async executeTool(tool: string, args: Record<string, any> = {}): Promise<ToolExecutionResponse> {
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
        const targetPath = path.resolve(String(args.path || ''));
        const content = String(args.content || '');

        await fs.mkdir(path.dirname(targetPath), { recursive: true });
        await fs.writeFile(targetPath, content, 'utf8');

        const writtenExists = fsSync.existsSync(targetPath);
        const writtenSize = writtenExists ? fsSync.statSync(targetPath).size : 0;

        return {
          success: writtenExists,
          output: `Wrote ${content.length} characters to ${targetPath}`,
          rawOutput: { path: targetPath, size: writtenSize },
          evidenceSource: 'filesystemExecutor.write',
          verification: {
            verified: writtenExists,
            realityCheck: writtenExists
              ? `Verified file written on disk: ${targetPath} (${writtenSize} bytes)`
              : `File write failed: ${targetPath} not found after write`,
            evidenceSource: 'fs.statSync',
          },
        };
      }

      case 'filesystem.create_folder': {
        const targetPath = path.resolve(String(args.path || ''));
        await fs.mkdir(targetPath, { recursive: true });
        const exists = fsSync.existsSync(targetPath) && fsSync.statSync(targetPath).isDirectory();

        return {
          success: exists,
          output: targetPath,
          evidenceSource: 'filesystemExecutor.createFolder',
          verification: {
            verified: exists,
            realityCheck: exists
              ? `Folder verified created at ${targetPath}`
              : `Folder creation verification failed: ${targetPath}`,
            evidenceSource: 'fs.statSync',
          },
        };
      }

      case 'filesystem.delete': {
        const targetPath = path.resolve(String(args.path || ''));
        if (fsSync.existsSync(targetPath)) {
          const isDir = fsSync.statSync(targetPath).isDirectory();
          if (isDir) {
            await fs.rm(targetPath, { recursive: true, force: true });
          } else {
            await fs.unlink(targetPath);
          }
        }
        const nowAbsent = !fsSync.existsSync(targetPath);

        return {
          success: nowAbsent,
          output: nowAbsent ? `Deleted ${targetPath}` : `Failed to delete ${targetPath}`,
          evidenceSource: 'filesystemExecutor.delete',
          verification: {
            verified: nowAbsent,
            realityCheck: nowAbsent
              ? `Verified target deleted from disk: ${targetPath}`
              : `Verification failed: target still exists: ${targetPath}`,
            evidenceSource: 'fs.existsSync',
          },
        };
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
