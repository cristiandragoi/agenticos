/**
 * Maintenance repository snapshot — Phase 4 hardening (Defect 3).
 *
 * The supervisor cannot rely on `git diff` alone: untracked files (the common
 * case for a freshly-seeded fixture) have no git baseline, so a content change
 * to an untracked file is invisible to `git status`/`git diff`.
 *
 * This module captures a bounded, deterministic snapshot of the repository that
 * COMBINES git's tracked-change status with content hashes of untracked files,
 * and computes a typed `ChangedFile[]` diff between two snapshots. That diff is
 * the AUTHORITATIVE record of what a repair actually changed — it is never
 * reconstructed from prose.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getGitState, type GitRepoState } from './gitState.js';
import type { ChangedFile, FileChangeType } from './changeSet.js';

/** A repository snapshot: tracked changes + untracked content hashes. */
export interface RepoSnapshot {
  repoPath: string;
  /** path → porcelain status (2-char, e.g. ' M', 'A ', '??', 'D '). */
  tracked: Map<string, string>;
  /** path → sha256 of file content (untracked files only). */
  untracked: Map<string, string>;
  capturedAt: string;
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'dist-electron', '.agentic', 'build', 'coverage']);

function hashFile(absPath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(absPath)).digest('hex');
}

/**
 * Expand git's untracked entries (which collapse untracked directories to
 * `?? dir/`) into per-file content hashes.
 */
function expandUntracked(repoPath: string, entries: GitRepoState['untracked']): Map<string, string> {
  const out = new Map<string, string>();
  const stack: string[] = entries.map((e) => e.path.replace(/\\/g, '/'));
  while (stack.length > 0) {
    const rel = stack.pop()!;
    const abs = path.join(repoPath, rel);
    let st: fs.Stats;
    try {
      st = fs.statSync(abs);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(rel)) continue;
      let children: string[];
      try {
        children = fs.readdirSync(abs);
      } catch {
        continue;
      }
      for (const c of children) stack.push(path.join(rel, c).replace(/\\/g, '/'));
    } else if (st.isFile()) {
      try {
        out.set(rel, hashFile(abs));
      } catch {
        out.set(rel, '<unreadable>');
      }
    }
  }
  return out;
}

/** Capture a full snapshot of the repository (tracked status + untracked hashes). */
export async function snapshotRepo(repoPath: string): Promise<RepoSnapshot> {
  const git = await getGitState(repoPath);
  const tracked = new Map<string, string>();
  for (const e of [...git.staged, ...git.modified, ...git.deleted]) {
    tracked.set(e.path.replace(/\\/g, '/'), e.status);
  }
  const untracked = expandUntracked(git.repoPath, git.untracked);
  return { repoPath: git.repoPath, tracked, untracked, capturedAt: new Date().toISOString() };
}

function statusChangeType(status: string): FileChangeType {
  if (status.includes('D')) return 'deleted';
  if (status[0] === 'A') return 'created';
  return 'modified';
}

/**
 * Compute the typed changed-file set between two snapshots. The result is the
 * authoritative evidence of what a repair touched — including untracked files
 * whose content changed (detected via hash), and tracked files whose git
 * status changed (modified / created / deleted).
 */
export function computeChangedFiles(before: RepoSnapshot, after: RepoSnapshot): ChangedFile[] {
  const byPath = new Map<string, ChangedFile>();
  const add = (p: string, t: FileChangeType) => {
    const n = p.replace(/\\/g, '/');
    const existing = byPath.get(n);
    if (!existing || (existing.changeType === 'modified' && t !== 'modified')) {
      byPath.set(n, { path: n, changeType: t });
    }
  };

  // Tracked: new / status-changed / deleted.
  for (const [p, statusAfter] of after.tracked) {
    const beforeStatus = before.tracked.get(p);
    if (beforeStatus === undefined) {
      add(p, statusChangeType(statusAfter));
    } else if (beforeStatus !== statusAfter) {
      add(p, statusChangeType(statusAfter));
    }
  }
  for (const p of before.tracked.keys()) {
    if (!after.tracked.has(p) && !after.untracked.has(p)) {
      add(p, 'deleted');
    }
  }

  // Untracked: created / content-modified / deleted (hash-based).
  for (const [p, hashAfter] of after.untracked) {
    const hashBefore = before.untracked.get(p);
    if (hashBefore === undefined) {
      add(p, 'created');
    } else if (hashBefore !== hashAfter) {
      add(p, 'modified');
    }
  }
  for (const p of before.untracked.keys()) {
    if (!after.untracked.has(p) && !after.tracked.has(p)) {
      add(p, 'deleted');
    }
  }

  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}

/** True when the two snapshots are identical (no change at all). */
export function snapshotsEqual(before: RepoSnapshot, after: RepoSnapshot): boolean {
  if (before.tracked.size !== after.tracked.size || before.untracked.size !== after.untracked.size) return false;
  for (const [p, s] of before.tracked) if (after.tracked.get(p) !== s) return false;
  for (const [p, h] of before.untracked) if (after.untracked.get(p) !== h) return false;
  return true;
}
