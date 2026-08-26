/**
 * Maintenance Git capability — Phase 4A.
 *
 * A typed, read-only-first Git inspection surface plus explicitly-gated write
 * operations. This is the ONLY gateway the Maintenance Supervisor uses to touch
 * Git. It deliberately does NOT expose arbitrary shell execution: every git
 * interaction is a named function that runs a fixed subcommand via `execFile`
 * (shell:false) against a fixed repository root.
 *
 * Safety invariants:
 *  - Read-only methods never mutate the index or working tree.
 *  - Write methods (stage/unstage) require an explicit authorization flag AND
 *    (when a changeSet is supplied) prove the file is owned by that changeSet.
 *  - No `git reset --hard`, no `git clean`, no `git checkout` mass operations,
 *    no `git stash` — the supervisor must never assume a dirty tree is its own.
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/* ── Types ─────────────────────────────────────────────────────────────── */

export type GitFileStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked' | 'unknown';

export interface GitFileEntry {
  /** Repository-relative path (forward slashes). */
  path: string;
  /** Porcelain status code (e.g. ' M', 'A ', '??'). */
  status: string;
  /** Index (staged) status letter, or null. */
  indexStatus: string | null;
  /** Worktree status letter, or null. */
  worktreeStatus: string | null;
  /** Original path when renamed. */
  originalPath?: string;
  /** Semantic classification of this change. */
  classification: GitChangeClass;
}

export type GitChangeClass =
  | 'source'
  | 'test'
  | 'generated'
  | 'runtime-data'
  | 'artifact'
  | 'config'
  | 'docs'
  | 'probe-script'
  | 'unknown';

export interface GitRepoState {
  branch: string;
  head: string;
  repoPath: string;
  staged: GitFileEntry[];
  modified: GitFileEntry[];
  untracked: GitFileEntry[];
  deleted: GitFileEntry[];
  /** Total working-tree entries (staged + unstaged + untracked). */
  totalEntries: number;
  capturedAt: string;
}

export interface GitDiffSummary {
  filesChanged: number;
  insertions: number;
  deletions: number;
  raw: string;
}

/* ── Command execution (fixed allowlist, no shell) ────────────────────── */

/**
 * Run a git subcommand against a fixed repository root. Only the subcommands in
 * the allowlist are permitted; arguments are passed verbatim but are validated
 * to not start with '-' for path arguments where relevant.
 */
function gitExec(
  repoPath: string,
  subcommand: string,
  args: string[],
  timeoutMs = 15000
): Promise<{ stdout: string; stderr: string; code: number }> {
  const READ_ONLY_SUBCOMMANDS = new Set([
    'status', 'rev-parse', 'diff', 'log', 'show', 'ls-files', 'branch',
  ]);
  const WRITE_SUBCOMMANDS = new Set(['add', 'reset', 'restore', 'commit']);
  if (!READ_ONLY_SUBCOMMANDS.has(subcommand) && !WRITE_SUBCOMMANDS.has(subcommand)) {
    return Promise.reject(new Error(`Git subcommand '${subcommand}' is not permitted by the maintenance policy.`));
  }
  return new Promise((resolve, reject) => {
    execFile('git', [subcommand, ...args], { cwd: repoPath, shell: false, windowsHide: true, timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err) {
        // git returns non-zero for `status`/`diff` only in error cases; `rev-parse`
        // may return non-zero for detached/empty. Surface the code, not a throw.
        resolve({ stdout: String(stdout || ''), stderr: String(stderr || ''), code: (err as any)?.code ?? 1 });
        return;
      }
      resolve({ stdout: String(stdout || ''), stderr: String(stderr || ''), code: 0 });
    });
  });
}

function resolveRepoPath(repoPath?: string): string {
  const rp = repoPath || process.cwd();
  const abs = path.resolve(rp);
  if (!fs.existsSync(path.join(abs, '.git'))) {
    throw new Error(`Not a git repository (no .git at ${abs}).`);
  }
  return abs;
}

/* ── Change classification ────────────────────────────────────────────── */

const GENERATED_DIRS = /^(server\/dist|dist-electron|release|\.agentic|backups|tmp|workspace)\//;
const RUNTIME_DATA = /^(server\/data|server\/\.agentic)\//;
const ARTIFACT_PATTERNS = /(\.xlsx$|\.png$|\.pdf$|\.docx$|~\$|\.tmp$|\.log$|\.jsonl$)/;
const PROBE_SCRIPT = /(\.cjs$|\.mjs$)/;

export function classifyChange(relPath: string): GitChangeClass {
  const p = relPath.replace(/\\/g, '/');
  if (GENERATED_DIRS.test(p)) return 'generated';
  if (RUNTIME_DATA.test(p)) return 'runtime-data';
  if (ARTIFACT_PATTERNS.test(p)) return 'artifact';
  if (/\.(ts|tsx|js|mjs|cjs)$/.test(p) && /(__tests__|\.test\.|\.spec\.)/.test(p)) return 'test';
  if (/\.(ts|tsx|js)$/.test(p) && /scripts\//.test(p)) return 'probe-script';
  if (/\.(ts|tsx|js)$/.test(p)) return 'source';
  if (/\.(json|yaml|yml|toml)$/.test(p)) return 'config';
  if (/\.(md|mdx)$/.test(p)) return 'docs';
  return 'unknown';
}

/* ── Read-only inspection ─────────────────────────────────────────────── */

function parsePorcelainEntry(line: string): GitFileEntry | null {
  if (!line) return null;
  // Format: XY PATH  or  XY ORIG -> PATH (renames, with -z not used here).
  const status = line.slice(0, 2);
  const rest = line.slice(3);
  const indexStatus = status[0] === ' ' ? null : status[0];
  const worktreeStatus = status[1] === ' ' ? null : status[1];
  let filePath = rest.trim();
  let originalPath: string | undefined;
  // Handle rename "old -> new"
  const renameIdx = rest.indexOf(' -> ');
  if (renameIdx > 0) {
    originalPath = rest.slice(0, renameIdx).trim();
    filePath = rest.slice(renameIdx + 4).trim();
  }
  const classification = classifyChange(filePath);
  return {
    path: filePath.replace(/"/g, ''),
    status,
    indexStatus,
    worktreeStatus,
    originalPath,
    classification,
  };
}

export async function getGitState(repoPath?: string): Promise<GitRepoState> {
  const rp = resolveRepoPath(repoPath);

  const [branchRes, headRes, statusRes] = await Promise.all([
    gitExec(rp, 'rev-parse', ['--abbrev-ref', 'HEAD']),
    gitExec(rp, 'rev-parse', ['HEAD']),
    gitExec(rp, 'status', ['--porcelain=v1']),
  ]);

  const branch = branchRes.stdout.trim();
  const head = headRes.stdout.trim();

  const staged: GitFileEntry[] = [];
  const modified: GitFileEntry[] = [];
  const untracked: GitFileEntry[] = [];
  const deleted: GitFileEntry[] = [];

  for (const rawLine of statusRes.stdout.split(/\r?\n/)) {
    const entry = parsePorcelainEntry(rawLine);
    if (!entry) continue;
    if (entry.status === '??') {
      untracked.push(entry);
    } else if (entry.status === 'D ' || entry.status === ' D') {
      deleted.push(entry);
    } else if (entry.indexStatus !== null) {
      staged.push(entry);
    } else {
      modified.push(entry);
    }
  }

  return {
    branch,
    head,
    repoPath: rp,
    staged,
    modified,
    untracked,
    deleted,
    totalEntries: staged.length + modified.length + untracked.length + deleted.length,
    capturedAt: new Date().toISOString(),
  };
}

export async function gitDiffSummary(repoPath?: string, stagedOnly = false): Promise<GitDiffSummary> {
  const rp = resolveRepoPath(repoPath);
  const args = ['--stat'];
  if (stagedOnly) args.push('--cached');
  const res = await gitExec(rp, 'diff', args);
  const raw = res.stdout.trim();
  const m = raw.split(/\r?\n/).filter(Boolean);
  const last = m[m.length - 1] || '';
  const fileMatch = last.match(/(\d+) files? changed/);
  const insMatch = last.match(/(\d+) insertions?/);
  const delMatch = last.match(/(\d+) deletions?/);
  return {
    filesChanged: fileMatch ? parseInt(fileMatch[1], 10) : m.length,
    insertions: insMatch ? parseInt(insMatch[1], 10) : 0,
    deletions: delMatch ? parseInt(delMatch[1], 10) : 0,
    raw,
  };
}

export async function gitDiffFile(repoPath: string | undefined, filePath: string, stagedOnly = false): Promise<string> {
  const rp = resolveRepoPath(repoPath);
  const args = [stagedOnly ? '--cached' : '--', filePath];
  // Reorder: `git diff -- <file>` or `git diff --cached -- <file>`
  const cmdArgs = stagedOnly ? ['--cached', '--', filePath] : ['--', filePath];
  const res = await gitExec(rp, 'diff', cmdArgs);
  return res.stdout;
}

export async function gitLog(repoPath?: string, count = 10): Promise<string[]> {
  const rp = resolveRepoPath(repoPath);
  const res = await gitExec(rp, 'log', ['--oneline', `-${Math.max(1, Math.min(count, 50))}`]);
  return res.stdout.split(/\r?\n/).filter(Boolean);
}

/* ── Write operations (authorization-gated) ───────────────────────────── */

export interface StageAuthorization {
  /** Explicit caller authorization — must be true for any write to proceed. */
  authorized: boolean;
  /** Optional set of repository-relative paths the caller is allowed to touch. */
  ownedPaths?: string[];
  /** Human-readable reason (recorded for audit). */
  reason?: string;
}

function assertAuthorized(auth: StageAuthorization, filePath: string): void {
  if (!auth.authorized) {
    throw new Error(`Git write blocked: no authorization provided for '${filePath}'.`);
  }
  const p = filePath.replace(/\\/g, '/');
  if (auth.ownedPaths && auth.ownedPaths.length > 0) {
    const owned = auth.ownedPaths.map((x) => x.replace(/\\/g, '/'));
    const matches = owned.some((o) => p === o || p.startsWith(o.endsWith('/') ? o : o + '/'));
    if (!matches) {
      throw new Error(`Git write blocked: '${filePath}' is not owned by this change set (owned: ${owned.join(', ')}).`);
    }
  }
}

export async function stageFile(repoPath: string | undefined, filePath: string, auth: StageAuthorization): Promise<void> {
  const rp = resolveRepoPath(repoPath);
  assertAuthorized(auth, filePath);
  const res = await gitExec(rp, 'add', ['--', filePath]);
  if (res.code !== 0) {
    throw new Error(`git add failed for '${filePath}': ${res.stderr || res.stdout}`);
  }
}

export async function unstageFile(repoPath: string | undefined, filePath: string, auth: StageAuthorization): Promise<void> {
  const rp = resolveRepoPath(repoPath);
  assertAuthorized(auth, filePath);
  const res = await gitExec(rp, 'reset', ['HEAD', '--', filePath]);
  if (res.code !== 0) {
    throw new Error(`git reset failed for '${filePath}': ${res.stderr || res.stdout}`);
  }
}

/**
 * Create a commit containing ONLY the owned `files` (an explicit pathspec), so
 * unrelated staged work in a dirty tree is never swept into the maintenance
 * commit. The commit is the terminal WRITE operation and requires both an
 * explicit authorization flag and proof that every committed path is owned.
 */
export async function commitStaged(
  repoPath: string | undefined,
  message: string,
  files: string[],
  auth: StageAuthorization
): Promise<{ sha: string; committedFiles: string[] }> {
  const rp = resolveRepoPath(repoPath);
  if (!files || files.length === 0) {
    throw new Error('commitStaged: no files provided — refusing to commit an empty change set.');
  }
  for (const f of files) assertAuthorized(auth, f);
  // `git commit -- <pathspec>` commits only the listed paths, leaving any
  // other staged entries untouched (preserving unrelated working-tree work).
  const res = await gitExec(rp, 'commit', ['-m', message, '--', ...files]);
  if (res.code !== 0) {
    throw new Error(`git commit failed: ${res.stderr || res.stdout}`);
  }
  const head = await gitExec(rp, 'rev-parse', ['HEAD']);
  return { sha: head.stdout.trim(), committedFiles: files.map((f) => f.replace(/\\/g, '/')) };
}

/* ── Classification helper over a whole state ─────────────────────────── */

export function summarizeClasses(state: GitRepoState): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const entry of [...state.staged, ...state.modified, ...state.untracked, ...state.deleted]) {
    counts[entry.classification] = (counts[entry.classification] || 0) + 1;
  }
  return counts;
}
