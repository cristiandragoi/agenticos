// Debug C3: trace the service's diff collection path.
import { CodingRuntimeService } from '../server/dist/domains/codingRuntime/service.js';
import { DEFAULT_CODING_POLICIES } from '../server/dist/domains/codingRuntime/providerPolicy.js';
import { getCodingRun } from '../server/dist/domains/codingRuntime/store.js';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'c3-debug-'));
const repo = path.join(root, 'repo');
fs.mkdirSync(repo);
execFileSync('git', ['init', '-b', 'main'], { cwd: repo, stdio: 'ignore', windowsHide: true });
execFileSync('git', ['config', 'user.email', 't@t'], { cwd: repo, stdio: 'ignore', windowsHide: true });
execFileSync('git', ['config', 'user.name', 't'], { cwd: repo, stdio: 'ignore', windowsHide: true });
fs.writeFileSync(path.join(repo, 'README.md'), 'hi\n');
execFileSync('git', ['add', '.'], { cwd: repo, stdio: 'ignore', windowsHide: true });
execFileSync('git', ['commit', '-qm', 'init'], { cwd: repo, stdio: 'ignore', windowsHide: true });

const service = new CodingRuntimeService(async () => ({}));
service.runWithAdapter = async (run) => {
  console.log('MOCK worktreePath=', run.worktreePath);
  fs.writeFileSync(path.join(run.worktreePath, 'new-file.txt'), 'x\n');
  return { status: 'completed', exitCode: 0, events: [], commands: [], agentMessages: ['done'], durationMs: 10 };
};

const run = await service.startRun({
  taskId: 'task-1', projectId: 'proj-1', projectTaskId: 'pt-1', workspace: repo,
  instructions: 'make change', acceptanceCriteria: 'test exists',
  providerPolicy: DEFAULT_CODING_POLICIES.default, allowedCommands: [],
});
await new Promise((r) => setTimeout(r, 2500));
const stored = getCodingRun(run.runId);
console.log('STATUS', stored?.status);
console.log('WORKTREE', stored?.worktreePath);
console.log('CHANGED', JSON.stringify(stored?.changedFiles));
console.log('VERIFIER', stored?.verifierVerdict);
console.log('ERRORS', JSON.stringify(stored?.errors));
try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
