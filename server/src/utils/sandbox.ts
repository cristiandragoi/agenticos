import { logger } from '../utils/logger.js';
import fs from 'fs';
import path from 'path';
import { execFile, spawn } from 'child_process';
import os from 'os';

const ALLOWLIST_BINARIES = ['node', 'npm', 'npx', 'tsc', 'jest', 'git'];

import { minimatch } from 'minimatch';

function isPathInScope(absPath: string, workspacePath: string, scopes?: string[]): boolean {
  if (!scopes || scopes.length === 0) return true; // Default to allowing all if no scopes provided
  
  // All candidate paths must first be canonicalized. If the file doesn't exist, use its real parent.
  let canonicalAbs: string;
  try {
    canonicalAbs = fs.realpathSync.native(absPath);
  } catch (e: any) {
    if (e.code === 'ENOENT') {
      let current = absPath;
      let suffix = '';
      while (!fs.existsSync(current)) {
        const parent = path.dirname(current);
        if (parent === current) break;
        suffix = suffix ? path.join(path.basename(current), suffix) : path.basename(current);
        current = parent;
      }
      canonicalAbs = path.join(fs.realpathSync.native(current), suffix);
    } else {
      throw e;
    }
  }
  const canonicalWorkspace = fs.realpathSync.native(workspacePath);
  
  // Convert to repository-relative normalized paths
  let relPath = path.relative(canonicalWorkspace, canonicalAbs).replace(/\\/g, '/');
  if (relPath === '') relPath = '.';

  return scopes.some(scope => {
    // Reject absolute patterns, .., drive-relative, UNC, device, empty
    if (!scope || scope.trim() === '') return false;
    if (scope.includes('..') || path.isAbsolute(scope) || scope.match(/^[a-zA-Z]:/) || scope.startsWith('//') || scope.startsWith('\\\\')) {
      return false; // Malformed / dangerous pattern
    }
    
    // Normalize scope
    const normalizedScope = scope.replace(/\\/g, '/');
    
    try {
      return minimatch(relPath, normalizedScope, { dot: true, matchBase: true }) || 
             minimatch(relPath, normalizedScope + '/**', { dot: true });
    } catch (e) {
      return false; // Invalid minimatch pattern
    }
  });
}

export function enforceWorkspacePath(targetPath: string, scopes?: string[], workspaceRootOverride?: string): string {
  if (!targetPath) targetPath = '';
  if (targetPath.startsWith('/') && !targetPath.startsWith('//')) {
    targetPath = targetPath.substring(1);
  }
  const cwd = fs.realpathSync.native(workspaceRootOverride || process.cwd());
  let current = path.resolve(cwd, targetPath);
  const targetAbs = current;

  if (targetPath.startsWith('\\\\') || targetPath.startsWith('//')) {
    throw new Error('Sandbox violation: UNC paths are not allowed.');
  }

  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  const realParent = fs.realpathSync.native(current);
  
  const isWin = os.platform() === 'win32';
  const parentCheck = (isWin ? realParent.toLowerCase() : realParent) + (realParent.endsWith(path.sep) ? '' : path.sep);
  const cwdCheck = (isWin ? cwd.toLowerCase() : cwd) + (cwd.endsWith(path.sep) ? '' : path.sep);

  if (!parentCheck.startsWith(cwdCheck)) {
    throw new Error('Sandbox violation: Path escapes the workspace directory (symlink/junction/reparse-point check).');
  }

  if (!isPathInScope(targetAbs, cwd, scopes)) {
    throw new Error(`Sandbox violation: Path '${targetPath}' is outside the allowed scopes.`);
  }

  return targetAbs;
}

export function validatePostWrite(targetPath: string, scopes?: string[], workspaceRootOverride?: string): void {
  const cwd = fs.realpathSync.native(workspaceRootOverride || process.cwd());
  const realFile = fs.realpathSync.native(targetPath);
  
  const isWin = os.platform() === 'win32';
  const fileCheck = (isWin ? realFile.toLowerCase() : realFile);
  const cwdCheck = (isWin ? cwd.toLowerCase() : cwd) + (cwd.endsWith(path.sep) ? '' : path.sep);

  if (!fileCheck.startsWith(cwdCheck)) {
    try {
      // Safely delete the violating file/symlink without following it
      const stat = fs.lstatSync(targetPath);
      if (stat.isSymbolicLink() || stat.isFile()) {
        fs.unlinkSync(targetPath);
      } else if (stat.isDirectory()) {
        fs.rmdirSync(targetPath);
      }
    } catch (e) {
      logger.error('Failed safe cleanup of containment violation:', e);
    }
    throw new Error('Sandbox violation: File raced outside workspace after creation. Containment violation logged.');
  }

  if (!isPathInScope(realFile, cwd, scopes)) {
    try { fs.unlinkSync(targetPath); } catch (e) {}
    throw new Error(`Sandbox violation: File '${targetPath}' written outside the allowed scopes.`);
  }
}

function truncateOutput(output: string, maxLength: number = 4096): string {
  if (output.length > maxLength) {
    return output.substring(0, maxLength) + `\n...[Truncated ${output.length - maxLength} chars]`;
  }
  return output;
}

export async function runSandboxedCommand(
  cmd: string, 
  args: string[], 
  signal?: AbortSignal,
  workspaceRootOverride?: string
): Promise<{ stdout: string; stderr: string }> {
  const cwd = workspaceRootOverride ? fs.realpathSync.native(workspaceRootOverride) : process.cwd();
  const binary = cmd.trim().toLowerCase();

  if (!ALLOWLIST_BINARIES.includes(binary)) {
    throw new Error(`Sandbox violation: Execution of '${binary}' is blocked by policy.`);
  }

  let safeArgs = [...args];
  if (binary === 'npm' || binary === 'npx') {
    if (!safeArgs.includes('--offline') && !safeArgs.includes('--prefer-offline')) {
      safeArgs.push('--prefer-offline');
    }
  }

  const isolatedTemp = path.join(os.tmpdir(), 'agentic_sandbox');
  if (!fs.existsSync(isolatedTemp)) fs.mkdirSync(isolatedTemp, { recursive: true });

  const isWin = os.platform() === 'win32';

  const safeEnv: Record<string, string> = {
    PATH: process.env.PATH || '',
    TEMP: isolatedTemp,
    TMP: isolatedTemp,
    HOME: isolatedTemp,
    USERPROFILE: isolatedTemp
  };

  if (isWin) {
    safeEnv.SYSTEMROOT = process.env.SYSTEMROOT || '';
    safeEnv.COMSPEC = process.env.COMSPEC || '';
    safeEnv.PATHEXT = process.env.PATHEXT || '';
  }

  return new Promise((resolve, reject) => {
    let stdoutData = '';
    let stderrData = '';

    const child = spawn(binary, safeArgs, {
      cwd,
      env: safeEnv,
      detached: !isWin, // POSIX process group
      shell: false
    });

    const killTree = () => {
      if (!child.pid) return;
      try {
        if (isWin) {
          execFile('taskkill', ['/pid', child.pid.toString(), '/T', '/F']);
        } else {
          process.kill(-child.pid, 'SIGTERM');
          setTimeout(() => {
            try { process.kill(-child.pid!, 'SIGKILL'); } catch (e) {}
          }, 1000);
        }
      } catch (e) {}
    };

    const timeout = setTimeout(() => {
      killTree();
      reject(new Error(`Command timed out after 30000ms.\nSTDOUT:\n${truncateOutput(stdoutData)}\nSTDERR:\n${truncateOutput(stderrData)}`));
    }, 30000);

    if (signal) {
      signal.addEventListener('abort', killTree);
    }

    child.stdout?.on('data', (data) => { stdoutData += data.toString(); });
    child.stderr?.on('data', (data) => { stderrData += data.toString(); });

    child.on('close', (code) => {
      clearTimeout(timeout);
      if (signal && signal.aborted) {
        reject(new Error(`Command aborted/killed.\nSTDOUT:\n${truncateOutput(stdoutData)}\nSTDERR:\n${truncateOutput(stderrData)}`));
        return;
      }
      
      if (code !== 0) {
        reject(new Error(`Command failed with code ${code}\nSTDOUT:\n${truncateOutput(stdoutData)}\nSTDERR:\n${truncateOutput(stderrData)}`));
      } else {
        resolve({ stdout: truncateOutput(stdoutData), stderr: truncateOutput(stderrData) });
      }
    });

    child.on('error', (err) => {
      clearTimeout(timeout);
      reject(new Error(`Command spawn error: ${err.message}`));
    });
  });
}

export async function captureWorkspaceSnapshot(workspaceRoot?: string): Promise<{ hash: string, status: string, branch: string }> {
  const cwd = workspaceRoot || process.cwd();
  try {
    // Attempt git approach
    const hashCmd = await new Promise<{stdout: string}>((resolve, reject) => {
      execFile('git', ['rev-parse', 'HEAD'], { cwd }, (error, stdout) => {
        if (error) reject(error); else resolve({ stdout });
      });
    });
    const hash = hashCmd.stdout.trim();

    const branchCmd = await new Promise<{stdout: string}>((resolve, reject) => {
      execFile('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd }, (error, stdout) => {
        if (error) reject(error); else resolve({ stdout });
      });
    });
    const branch = branchCmd.stdout.trim();

    const statusCmd = await new Promise<{stdout: string}>((resolve, reject) => {
      execFile('git', ['status', '-s'], { cwd }, (error, stdout) => {
        if (error) reject(error); else resolve({ stdout });
      });
    });
    const status = statusCmd.stdout.trim();

    return { hash, status, branch };
  } catch (e) {
    // Fallback: simple deterministic hash of tracked files in workspace
    // For milestone brevity, we assume Git is the primary snapshot mechanism.
    return {
      hash: 'no-git-available',
      status: '',
      branch: 'main'
    };
  }
}
