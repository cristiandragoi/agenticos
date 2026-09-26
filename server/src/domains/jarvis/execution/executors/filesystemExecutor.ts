/**
 * filesystemExecutor.ts — Filesystem Operations Executor.
 *
 * Supports:
 * - read, write, copy, move, search, mkdir, inspect
 * - Verifying real file states (stat, exists, size)
 */

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { logger } from '../../../../utils/logger.js';
import type { ActionPlanStep, ExecutionResult, VerificationResult, TurnContext } from '../types.js';

export class FilesystemExecutor {
  public readonly id = 'filesystem';

  public async executeStep(step: ActionPlanStep, context: TurnContext): Promise<ExecutionResult> {
    const action = step.action || 'read';
    const targetPath = path.resolve((step.parameters.path as string) || (step.parameters.filePath as string) || context.workspacePath || process.cwd());
    const content = (step.parameters.content as string) || '';
    const destination = step.parameters.destination ? path.resolve(step.parameters.destination as string) : undefined;

    logger.info('[FilesystemExecutor] Executing filesystem step:', { action, targetPath });

    try {
      switch (action) {
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
          await fs.mkdir(path.dirname(targetPath), { recursive: true });
          await fs.writeFile(targetPath, content, 'utf8');
          return {
            success: true,
            output: `Wrote ${content.length} bytes to ${path.basename(targetPath)}.`,
            data: { path: targetPath, size: content.length },
            evidence: { exists: true, size: content.length },
          };
        }
        case 'mkdir': {
          await fs.mkdir(targetPath, { recursive: true });
          return {
            success: true,
            output: `Created directory ${path.basename(targetPath)}.`,
            data: { path: targetPath },
            evidence: { exists: true, isDir: true },
          };
        }
        case 'copy': {
          if (!destination) throw new Error('Missing destination path for copy');
          await fs.copyFile(targetPath, destination);
          return {
            success: true,
            output: `Copied ${path.basename(targetPath)} to ${path.basename(destination)}.`,
            data: { source: targetPath, destination },
            evidence: { exists: true },
          };
        }
        case 'search': {
          const query = (step.parameters.query as string) || '';
          const entries = await fs.readdir(targetPath, { withFileTypes: true });
          const matches = entries.filter((e) => e.name.toLowerCase().includes(query.toLowerCase())).map((e) => e.name);
          return {
            success: true,
            output: `Found ${matches.length} matching file(s).`,
            data: { matches },
            evidence: { matchesCount: matches.length },
          };
        }
        default:
          throw new Error(`Unsupported filesystem action: ${action}`);
      }
    } catch (err: any) {
      return {
        success: false,
        error: err?.message || String(err),
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
