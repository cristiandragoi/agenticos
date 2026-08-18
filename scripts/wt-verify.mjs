// Verify collectWorktreeDiff captures untracked files in a real worktree.
import { createWorktree, collectWorktreeDiff, removeWorktree } from '../server/dist/domains/codingRuntime/gitWorktree.js';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-verify-'));
const repo = path.join(root, 'repo');
fs.mkdirSync(repo);
execFileSync('git', ['init', '-b', 'main'], { cwd: repo, stdio: 'ignore', windowsHide: true });
execFileSync('git', ['config', 'user.email', 't@t'], { cwd: repo, stdio: 'ignore', windowsHide: true });
execFileSync('git', ['config', 'user.name', 't'], { cwd: repo, stdio: 'ignore', windowsHide: true });
fs.writeFileSync(path.join(repo, 'README.md'), 'hi\n');
execFileSync('git', ['add', '.'], { cwd: repo, stdio: 'ignore', windowsHide: true });
execFileSync('git', ['commit', '-qm', 'init'], { cwd: repo, stdio: 'ignore', windowsHide: true });

const info = await createWorktree({ taskId: 't', runId: 'verify1', repoPath: repo });
fs.writeFileSync(path.join(info.worktreePath, 'new-file.txt'), 'x\n');
const d = collectWorktreeDiff(info.worktreePath, info.baseCommit);
console.log('CHANGED', JSON.stringify(d.changedFiles));
console.log('SUMMARY', JSON.stringify(d.summary.slice(0, 200)));
removeWorktree(repo, info.worktreePath, info.branch);
try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
