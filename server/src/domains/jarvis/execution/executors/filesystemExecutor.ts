/**
 * filesystemExecutor.ts — Filesystem Operations Executor.
 *
 * Supports:
 * - locate, search, open, reveal, list, read, write
 * - Generic Windows file & directory search across Desktop, Documents, Downloads, Workspaces, and Drives
 * - Launching files with native Windows default associations (start / Start-Process)
 * - Revealing items in File Explorer (/select)
 * - Verifying real file states (stat, exists, size)
 */

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { logger } from '../../../../utils/logger.js';
import {
  assertConfinedWorkspacePath,
  ConfinementError,
  getDedicatedWorkspaceRoot,
} from '../../../localWorker/workspaceConfinement.js';
import {
  getSupervisorApprovalVerifier,
  getRuntimeDeploymentIdentity,
  approvalHash,
  type ApprovalBinding,
  type SignedApprovalEnvelope,
} from '../../../securitySupervisor/approvalVerifier.js';
import type { ActionPlanStep, ExecutionResult, VerificationResult, TurnContext } from '../types.js';

export interface FileItemMatch {
  path: string;
  name: string;
  isDirectory: boolean;
  size: number;
  mtime: number;
}

export class FilesystemExecutor {
  public readonly id = 'filesystem';

  /**
   * Search filesystem for file or folder matching query.
   * Searches designated scopes with depth cap for high speed.
   */
  public async locateFileOrFolder(
    query: string,
    options: {
      scope?: 'desktop' | 'downloads' | 'documents' | 'workspace' | 'all' | string;
      targetType?: 'file' | 'folder' | 'any';
      maxDepth?: number;
    } = {}
  ): Promise<FileItemMatch[]> {
    const {
      scope = 'all',
      targetType = 'any',
      maxDepth = 3,
    } = options;

    const trimmedQuery = query.trim().toLowerCase();
    if (!trimmedQuery) return [];

    // Tokenize query words (e.g. "kündigung zimmer 5" -> ["kündigung", "zimmer", "5"])
    const queryTokens = trimmedQuery.split(/[\s_\-.]+/).filter((t) => t.length > 0);

    const getDesktopPaths = (): string[] => {
      const paths = [
        path.join(os.homedir(), 'Desktop'),
        path.join(os.homedir(), 'OneDrive', 'Desktop'),
        process.env.ONEDRIVE ? path.join(process.env.ONEDRIVE, 'Desktop') : '',
      ].filter((p): p is string => Boolean(p) && fsSync.existsSync(p));
      return Array.from(new Set(paths));
    };

    const getDocumentsPaths = (): string[] => {
      const paths = [
        path.join(os.homedir(), 'Documents'),
        path.join(os.homedir(), 'OneDrive', 'Documents'),
        path.join(os.homedir(), 'OneDrive', 'Dokumente'),
        process.env.ONEDRIVE ? path.join(process.env.ONEDRIVE, 'Documents') : '',
        process.env.ONEDRIVE ? path.join(process.env.ONEDRIVE, 'Dokumente') : '',
      ].filter((p): p is string => Boolean(p) && fsSync.existsSync(p));
      return Array.from(new Set(paths));
    };

    const getDownloadsPaths = (): string[] => {
      const paths = [
        path.join(os.homedir(), 'Downloads'),
      ].filter((p): p is string => Boolean(p) && fsSync.existsSync(p));
      return Array.from(new Set(paths));
    };

    const searchRoots: string[] = [];
    const desktopPaths = getDesktopPaths();
    const downloadsPaths = getDownloadsPaths();
    const documentsPaths = getDocumentsPaths();
    const workspacePath = 'D:\\AgenticOS';

    if (typeof scope === 'string' && scope.includes(':\\')) {
      if (fsSync.existsSync(scope)) searchRoots.push(scope);
    } else if (scope === 'desktop') {
      searchRoots.push(...desktopPaths);
    } else if (scope === 'downloads') {
      searchRoots.push(...downloadsPaths);
    } else if (scope === 'documents') {
      searchRoots.push(...documentsPaths);
    } else if (scope === 'workspace') {
      if (fsSync.existsSync(workspacePath)) searchRoots.push(workspacePath);
    } else {
      // 'all' search standard user and dev locations
      searchRoots.push(...desktopPaths);
      if (fsSync.existsSync(workspacePath)) searchRoots.push(workspacePath);
      if (fsSync.existsSync('D:\\')) searchRoots.push('D:\\');
      searchRoots.push(...downloadsPaths);
      searchRoots.push(...documentsPaths);
    }

    const matches: FileItemMatch[] = [];
    const visited = new Set<string>();

    const checkMatch = (name: string, isDir: boolean): boolean => {
      if (targetType === 'folder' && !isDir) return false;
      if (targetType === 'file' && isDir) return false;

      const lowerName = name.toLowerCase();
      // Direct substring match
      if (lowerName.includes(trimmedQuery)) return true;

      // Token match: all tokens present
      if (queryTokens.length > 1 && queryTokens.every((token) => lowerName.includes(token))) {
        return true;
      }
      return false;
    };

    const walk = async (currentDir: string, depth: number) => {
      if (depth > maxDepth || matches.length >= 20) return;
      if (visited.has(currentDir)) return;
      visited.add(currentDir);

      try {
        const entries = await fs.readdir(currentDir, { withFileTypes: true });
        for (const entry of entries) {
          // Skip noisy or massive directories
          if (
            entry.name === 'node_modules' ||
            entry.name === '.git' ||
            entry.name === 'dist' ||
            entry.name === 'dist-electron' ||
            entry.name === '$RECYCLE.BIN' ||
            entry.name === 'AppData' ||
            entry.name.startsWith('.')
          ) {
            continue;
          }

          const fullPath = path.join(currentDir, entry.name);
          const isDir = entry.isDirectory();

          if (checkMatch(entry.name, isDir)) {
            try {
              const stat = await fs.stat(fullPath);
              matches.push({
                path: fullPath,
                name: entry.name,
                isDirectory: isDir,
                size: stat.size,
                mtime: stat.mtimeMs,
              });
            } catch {
              matches.push({
                path: fullPath,
                name: entry.name,
                isDirectory: isDir,
                size: 0,
                mtime: Date.now(),
              });
            }
          }

          if (isDir && depth < maxDepth) {
            await walk(fullPath, depth + 1);
          }
        }
      } catch {
        // Ignore permission errors or transient lock
      }
    };

    for (const root of searchRoots) {
      // Check if root itself matches (e.g. D:\AgenticOS matching "AgenticOS")
      if (checkMatch(path.basename(root), true)) {
        try {
          const stat = await fs.stat(root);
          matches.push({
            path: root,
            name: path.basename(root),
            isDirectory: true,
            size: stat.size,
            mtime: stat.mtimeMs,
          });
        } catch {}
      }
      await walk(root, 1);
      if (matches.length >= 20) break;
    }

    return matches;
  }

  /**
   * Open file with Windows default associated application.
   */
  public async openFile(
    filePath: string,
    options?: { approval?: SignedApprovalEnvelope }
  ): Promise<{ success: boolean; path: string; error?: string }> {
    const resolved = path.resolve(filePath);
    if (!fsSync.existsSync(resolved)) {
      return { success: false, path: resolved, error: `File not found: ${resolved}` };
    }

    const isTestBypass = process.env.AGENTICOS_AUTH_TEST_BYPASS === 'true';
    if (!isTestBypass) {
      if (!options?.approval) {
        logger.warn('[FilesystemExecutor] Blocked openFile without verified human approval:', { filePath: resolved });
        return {
          success: false,
          path: resolved,
          error: 'APPROVAL_REQUIRED: Opening file with system application requires verified human approval.',
        };
      }
      try {
        const expectedBinding: ApprovalBinding = {
          goalId: 'filesystem-open',
          graphId: 'filesystem',
          nodeId: 'openFile',
          workerId: 'filesystemExecutor',
          operation: 'FILESYSTEM_OPEN',
          attempt: 1,
          tool: 'filesystem.open',
          scopeHash: approvalHash({ path: resolved }),
          argumentHash: approvalHash({ path: resolved }),
          previewHash: approvalHash(`Open file ${resolved}`),
          runtimeIncarnation: getRuntimeDeploymentIdentity().incarnation,
          bootTimestamp: getRuntimeDeploymentIdentity().bootTimestamp,
        };
        getSupervisorApprovalVerifier().consume(options.approval.payload, options.approval.signature, expectedBinding);
      } catch (err: any) {
        return {
          success: false,
          path: resolved,
          error: `APPROVAL_VERIFICATION_FAILED: ${err?.message || String(err)}`,
        };
      }
    }

    try {
      if (process.platform === 'win32') {
        const child = spawn('cmd.exe', ['/c', 'start', '', resolved], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
        });
        child.unref();
      } else {
        const child = spawn('xdg-open', [resolved], {
          detached: true,
          stdio: 'ignore',
        });
        child.unref();
      }
      return { success: true, path: resolved };
    } catch (err: any) {
      return { success: false, path: resolved, error: err?.message || String(err) };
    }
  }

  /**
   * Reveal file or folder in Windows File Explorer.
   */
  public async revealInExplorer(
    targetPath: string,
    options?: { approval?: SignedApprovalEnvelope }
  ): Promise<{ success: boolean; path: string; error?: string }> {
    const resolved = path.resolve(targetPath);
    if (!fsSync.existsSync(resolved)) {
      return { success: false, path: resolved, error: `Path not found: ${resolved}` };
    }

    const isTestBypass = process.env.AGENTICOS_AUTH_TEST_BYPASS === 'true';
    if (!isTestBypass) {
      if (!options?.approval) {
        logger.warn('[FilesystemExecutor] Blocked revealInExplorer without verified human approval:', { targetPath: resolved });
        return {
          success: false,
          path: resolved,
          error: 'APPROVAL_REQUIRED: Revealing path in File Explorer requires verified human approval.',
        };
      }
      try {
        const expectedBinding: ApprovalBinding = {
          goalId: 'filesystem-reveal',
          graphId: 'filesystem',
          nodeId: 'revealInExplorer',
          workerId: 'filesystemExecutor',
          operation: 'FILESYSTEM_REVEAL',
          attempt: 1,
          tool: 'filesystem.reveal',
          scopeHash: approvalHash({ path: resolved }),
          argumentHash: approvalHash({ path: resolved }),
          previewHash: approvalHash(`Reveal in explorer: ${resolved}`),
          runtimeIncarnation: getRuntimeDeploymentIdentity().incarnation,
          bootTimestamp: getRuntimeDeploymentIdentity().bootTimestamp,
        };
        getSupervisorApprovalVerifier().consume(options.approval.payload, options.approval.signature, expectedBinding);
      } catch (err: any) {
        return {
          success: false,
          path: resolved,
          error: `APPROVAL_VERIFICATION_FAILED: ${err?.message || String(err)}`,
        };
      }
    }

    try {
      if (process.platform === 'win32') {
        const child = spawn('explorer.exe', [`/select,${resolved}`], {
          detached: true,
          stdio: 'ignore',
          windowsHide: false,
        });
        child.unref();
      }
      return { success: true, path: resolved };
    } catch (err: any) {
      return { success: false, path: resolved, error: err?.message || String(err) };
    }
  }

  /**
   * Confined file write (SEC-05).
   * Validates target path against workspace root via realpath and junction/symlink checks.
   * Outside-workspace writes fail closed with CONFINEMENT_VIOLATION.
   */
  public async writeFile(
    targetPath: string,
    content: string,
    options: { workspaceRoot?: string } = {}
  ): Promise<{ success: boolean; path: string; size: number }> {
    const confined = await assertConfinedWorkspacePath(targetPath, {
      forWrite: true,
      workspaceRoot: options.workspaceRoot,
    });
    await fs.mkdir(path.dirname(confined), { recursive: true });
    await fs.writeFile(confined, content, 'utf8');
    const size = Buffer.byteLength(content, 'utf8');
    return { success: true, path: confined, size };
  }

  /**
   * Confined directory / folder creation (SEC-05).
   */
  public async createFolder(
    targetPath: string,
    options: { workspaceRoot?: string } = {}
  ): Promise<{ success: boolean; path: string }> {
    const confined = await assertConfinedWorkspacePath(targetPath, {
      allowDirectory: true,
      forWrite: true,
      workspaceRoot: options.workspaceRoot,
    });
    await fs.mkdir(confined, { recursive: true });
    return { success: true, path: confined };
  }

  /**
   * Confined file or folder deletion (SEC-05).
   */
  public async deletePath(
    targetPath: string,
    options: { workspaceRoot?: string } = {}
  ): Promise<{ success: boolean; path: string }> {
    const confined = await assertConfinedWorkspacePath(targetPath, {
      allowDirectory: true,
      forWrite: true,
      workspaceRoot: options.workspaceRoot,
    });

    // Refuse deletion of the workspace root itself
    const root = options.workspaceRoot ? path.resolve(options.workspaceRoot) : getDedicatedWorkspaceRoot();
    if (path.resolve(confined).toLowerCase() === path.resolve(root).toLowerCase()) {
      throw new ConfinementError('Refusing to delete the workspace root directory itself');
    }

    if (fsSync.existsSync(confined)) {
      const stat = await fs.lstat(confined);
      if (stat.isDirectory()) {
        await fs.rm(confined, { recursive: true, force: true });
      } else {
        await fs.unlink(confined);
      }
    }
    return { success: true, path: confined };
  }

  public async executeStep(step: ActionPlanStep, context: TurnContext): Promise<ExecutionResult> {
    const action = step.action || 'read';
    const targetPath = path.resolve((step.parameters.path as string) || (step.parameters.filePath as string) || context?.workspacePath || process.cwd());
    const content = (step.parameters.content as string) || '';
    const destination = step.parameters.destination ? path.resolve(step.parameters.destination as string) : undefined;

    logger.info('[FilesystemExecutor] Executing filesystem step:', { action, targetPath });

    try {
      switch (action) {
        case 'locate': {
          const query = (step.parameters.query as string) || (step.parameters.targetName as string) || '';
          const scope = (step.parameters.scope as string) || 'all';
          const targetType = (step.parameters.targetType as 'file' | 'folder' | 'any') || 'any';
          const matches = await this.locateFileOrFolder(query, { scope, targetType });
          const success = matches.length > 0;
          return {
            success,
            output: success
              ? `Found ${matches[0].name} at ${matches[0].path}.`
              : `Could not find any file or folder matching "${query}".`,
            data: { matches, topMatch: matches[0] || null },
            evidence: { matchesCount: matches.length, topPath: matches[0]?.path },
          };
        }
        case 'open': {
          const approval = (step.parameters.approval as SignedApprovalEnvelope) || undefined;
          const res = await this.openFile(targetPath, { approval });
          return {
            success: res.success,
            output: res.success ? `Opened ${path.basename(targetPath)}.` : `Failed to open ${path.basename(targetPath)}: ${res.error}`,
            data: res,
            evidence: { opened: res.success, path: targetPath },
          };
        }
        case 'reveal': {
          const approval = (step.parameters.approval as SignedApprovalEnvelope) || undefined;
          const res = await this.revealInExplorer(targetPath, { approval });
          return {
            success: res.success,
            output: res.success ? `Revealed ${path.basename(targetPath)} in Explorer.` : `Failed to reveal: ${res.error}`,
            data: res,
            evidence: { revealed: res.success, path: targetPath },
          };
        }
        case 'read': {
          const text = await fs.readFile(targetPath, 'utf8');
          const lines = text.split('\n').length;
          return {
            success: true,
            output: `Read ${lines} lines from ${path.basename(targetPath)}.`,
            data: { path: targetPath, size: text.length, lines, content: text },
            evidence: { exists: true, size: text.length },
          };
        }
        case 'write': {
          const res = await this.writeFile(targetPath, content, { workspaceRoot: context?.workspacePath });
          return {
            success: true,
            output: `Wrote ${res.size} bytes to ${path.basename(res.path)}.`,
            data: { path: res.path, size: res.size },
            evidence: { exists: true, size: res.size },
          };
        }
        case 'create':
        case 'create_folder': {
          const res = await this.createFolder(targetPath, { workspaceRoot: context?.workspacePath });
          return {
            success: true,
            output: `Created folder at ${res.path}.`,
            data: { path: res.path },
            evidence: { exists: true },
          };
        }
        case 'delete': {
          const res = await this.deletePath(targetPath, { workspaceRoot: context?.workspacePath });
          return {
            success: true,
            output: `Deleted ${res.path}.`,
            data: { path: res.path },
            evidence: { deleted: true },
          };
        }
        case 'list': {
          const entries = await fs.readdir(targetPath, { withFileTypes: true });
          const items = entries.map((e) => ({ name: e.name, isDirectory: e.isDirectory() }));
          return {
            success: true,
            output: `Directory ${path.basename(targetPath)} contains ${items.length} items.`,
            data: { path: targetPath, items },
            evidence: { count: items.length },
          };
        }
        default:
          throw new Error(`Unsupported filesystem action: ${action}`);
      }
    } catch (err: any) {
      const isConfinement = err instanceof ConfinementError ||
        err?.code === 'CONFINEMENT_VIOLATION' ||
        String(err?.message || '').includes('CONFINEMENT_VIOLATION');
      return {
        success: false,
        error: err?.message || String(err),
        ...(isConfinement ? { code: 'CONFINEMENT_VIOLATION' } : {}),
      };
    }
  }

  public async verify(result: ExecutionResult): Promise<VerificationResult> {
    const data = result.data as any;
    if (!result.success || !data?.path) {
      return {
        verified: result.success,
        realityCheck: result.output || result.error || 'Filesystem action complete',
        error: result.error,
      };
    }

    const exists = fsSync.existsSync(data.path);
    return {
      verified: exists,
      realityCheck: exists
        ? `Confirmed file/directory exists at ${data.path}`
        : `File verification failed: ${data.path} does not exist on disk`,
      actualState: { path: data.path, exists },
      error: exists ? undefined : 'File not found after operation',
    };
  }
}

export const filesystemExecutor = new FilesystemExecutor();
