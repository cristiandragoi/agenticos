/**
 * domains/codingRuntime/gitWorktree.ts — safe git worktree isolation
 * (Phase 5/6).
 *
 * Rules enforced:
 *  - NEVER reset/discard/stash the parent repo.
 *  - Worktrees are created from a KNOWN COMMIT (base SHA), not from a dirty
 *    working tree.
 *  - A dirty parent is reported, never touched.
 *  - Branch naming: agentic/codex/<task-or-run-id>.
 *  - Cleanup removes only the disposable worktree + branch; never the parent.
 */

import { execFileSync, execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { logger } from '../../utils/logger.js';

export interface WorktreeInfo {
  worktreePath: string;
  branch: string;
  baseCommit: string;
  baseBranch: string;
  parentDirty: boolean;
  parentUncommittedPaths: string[];
  created: string;
}

function runGit(cwd: string, args: string[], timeoutMs = 30000): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', timeout: timeoutMs, windowsHide: true }).trim();
}

export function gitStatus(cwd: string): { dirty: boolean; paths: string[] } {
  try {
    const out = runGit(cwd, ['status', '--porcelain']);
    const paths = out.split(/\r?\n/).filter((l) => l.trim().length > 0);
    return { dirty: paths.length > 0, paths };
  } catch {
    return { dirty: false, paths: [] };
  }
}

export function gitHead(cwd: string): string {
  return runGit(cwd, ['rev-parse', 'HEAD']);
}

export function gitCurrentBranch(cwd: string): string {
  try {
    return runGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
  } catch {
    return 'HEAD';
  }
}

export function isGitRepo(cwd: string): boolean {
  try {
    runGit(cwd, ['rev-parse', '--is-inside-work-tree']);
    return true;
  } catch {
    return false;
  }
}

export interface CreateWorktreeOptions {
  taskId: string;
  runId: string;
  repoPath: string;
  baseBranch?: string;
  timeoutMs?: number;
}

/**
 * Create an isolated worktree for a coding run.
 *
 * Sequence:
 *  1. verify the repo exists and is a git repo
 *  2. read the CURRENT base branch + HEAD SHA (the known commit)
 *  3. create branch `agentic/codex/<runId>` at HEAD
 *  4. `git worktree add <worktreePath> <branch>` (detached-safe: we add by branch)
 *  5. verify the worktree path resolves and records base commit
 *
 * If the parent has uncommitted work, it is REPORTED and left untouched —
 * the worktree is created from the committed HEAD.
 */
export async function createWorktree(opts: CreateWorktreeOptions): Promise<WorktreeInfo> {
  const repoPath = path.resolve(opts.repoPath);
  if (!fs.existsSync(repoPath)) throw new Error(`Repository path does not exist: ${repoPath}`);
  if (!isGitRepo(repoPath)) throw new Error(`Not a git repository: ${repoPath}`);

  const baseBranch = opts.baseBranch || gitCurrentBranch(repoPath);
  const baseCommit = gitHead(repoPath);
  const { dirty, paths } = gitStatus(repoPath);

  const runTag = opts.runId.replace(/[^A-Za-z0-9_-]/g, '-');
  const branch = `agentic/codex/${runTag}`;
  // Worktrees live OUTSIDE the repo (sibling directory) — correct git
  // practice, keeps the parent/protected checkout byte-identical, and
  // prevents untracked worktrees/ noise inside the repo.
  const worktreeBase = path.join(path.dirname(repoPath), 'agentic-worktrees');
  const worktreePath = path.join(worktreeBase, runTag);

  // Cleanup any stale worktree from a previous identical run tag (disposable).
  try {
    runGit(repoPath, ['worktree', 'remove', '--force', worktreePath]);
  } catch { /* no stale worktree */ }
  try {
    runGit(repoPath, ['branch', '-D', branch]);
  } catch { /* no stale branch */ }

  // Create branch at the known commit.
  runGit(repoPath, ['branch', branch, baseCommit]);
  fs.mkdirSync(path.dirname(worktreePath), { recursive: true });

  try {
    runGit(repoPath, ['worktree', 'add', worktreePath, branch]);
  } catch (err: any) {
    // Roll back the branch on failure.
    try { runGit(repoPath, ['branch', '-D', branch]); } catch { /* ignore */ }
    throw err;
  }

  // Verify the worktree resolves.
  const actualHead = gitHead(worktreePath);
  if (actualHead !== baseCommit) {
    throw new Error(`Worktree base commit mismatch: expected ${baseCommit}, got ${actualHead}`);
  }

  logger.info(`[CodingRuntime] Worktree created: ${worktreePath} branch=${branch} base=${baseCommit.slice(0, 12)} dirty=${dirty}`);
  return {
    worktreePath,
    branch,
    baseCommit,
    baseBranch,
    parentDirty: dirty,
    parentUncommittedPaths: paths,
    created: new Date().toISOString(),
  };
}

/** Remove ONLY the disposable worktree + its branch. Never touches parent files. */
export function removeWorktree(repoPath: string, worktreePath: string, branch?: string): void {
  try {
    execFileSync('git', ['worktree', 'remove', '--force', worktreePath], { cwd: repoPath, stdio: 'ignore', windowsHide: true });
  } catch { /* already removed */ }
  if (branch) {
    try {
      execFileSync('git', ['branch', '-D', branch], { cwd: repoPath, stdio: 'ignore', windowsHide: true });
    } catch { /* already removed */ }
  }
}

/** Collect a bounded unified diff of changed files vs baseCommit. */
export function collectDiff(repoPath: string, baseCommit: string, timeoutMs = 30000): { diff: string; summary: string; changedFiles: string[] } {
  const diff = execFileSync('git', ['diff', baseCommit, '--stat', '.', ':(exclude)worktrees'], { cwd: repoPath, encoding: 'utf8', timeout: timeoutMs, windowsHide: true });
  const patch = execFileSync('git', ['diff', baseCommit, '.', ':(exclude)worktrees'], { cwd: repoPath, encoding: 'utf8', timeout: timeoutMs, windowsHide: true });
  const changed = execFileSync('git', ['diff', '--name-only', baseCommit, '.', ':(exclude)worktrees'], { cwd: repoPath, encoding: 'utf8', timeout: timeoutMs, windowsHide: true })
    .split(/\r?\n/).filter(Boolean);
  return { diff: patch.slice(0, 200_000), summary: diff, changedFiles: changed };
}

/** Collect the diff INSIDE a worktree (working tree + committed changes vs the
 *  recorded BASE commit — Codex may auto-commit, so comparing against HEAD
 *  would miss the changes). */
export function collectWorktreeDiff(worktreePath: string, baseCommit: string, timeoutMs = 30000): { diff: string; summary: string; changedFiles: string[] } {
  const diff = execFileSync('git', ['diff', baseCommit, '--stat'], { cwd: worktreePath, encoding: 'utf8', timeout: timeoutMs, windowsHide: true });
  let patch = execFileSync('git', ['diff', baseCommit], { cwd: worktreePath, encoding: 'utf8', timeout: timeoutMs, windowsHide: true });
  const tracked = execFileSync('git', ['diff', '--name-only', baseCommit], { cwd: worktreePath, encoding: 'utf8', timeout: timeoutMs, windowsHide: true })
    .split(/\r?\n/).filter(Boolean);
  // Untracked files do not appear in git diff; include them as evidence so
  // new-file changes (common in Codex runs) are captured truthfully.
  let untracked: string[] = [];
  try {
    untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], { cwd: worktreePath, encoding: 'utf8', timeout: timeoutMs, windowsHide: true })
      .split(/\r?\n/).filter(Boolean);
  } catch { /* ignore */ }
  // Synthesize a diff chunk for untracked files so diffRef is never empty
  // when the run added files.
  for (const f of untracked) {
    try {
      const rel = f.replace(/\\/g, '/');
      const content = fs.readFileSync(path.join(worktreePath, f), 'utf8').slice(0, 50_000);
      patch += `\ndiff --git a/${rel} b/${rel}\nnew file mode 100644\n--- /dev/null\n+++ b/${rel}\n@@ -0,0 +1,${content.split(/\r?\n/).filter(Boolean).length} @@\n${content.split(/\r?\n/).map((l) => `+${l}`).join('\n')}\n`;
    } catch { /* skip unreadable */ }
  }
  const changedFiles = [...new Set([...tracked, ...untracked])];
  return { diff: patch.slice(0, 200_000), summary: diff || untracked.map((f) => `?? ${f}`).join('\n'), changedFiles };
}

/** Run a verification command and return its exit code + bounded output (redacted later). */
export function runTestCommand(cwd: string, command: string, args: string[], timeoutMs = 120000): Promise<{ exitCode: number; output: string; error: string }> {
  return new Promise((resolve) => {
    const child = execFile(command, args, { cwd, timeout: timeoutMs, windowsHide: true, maxBuffer: 2 * 1024 * 1024 }, (err: any, stdout: string, stderr: string) => {
      const exitCode = err ? (err.code ?? err.status ?? 1) : 0;
      resolve({ exitCode: typeof exitCode === 'number' ? exitCode : 1, output: stdout || '', error: stderr || '' });
    });
  });
}
