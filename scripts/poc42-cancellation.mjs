// P42 — live cancellation POC (standalone, real Codex CLI, OpenAI auth).
// Start a bounded run, cancel it mid-flight, verify: cancelled status,
// no fallback, worktree intact, a NEW run still works afterward.
import { CodingRuntimeService } from '../server/dist/domains/codingRuntime/service.js';
import { getCodingPolicy } from '../server/dist/domains/codingRuntime/providerPolicy.js';
import { getCodingRun, listCodingRuns } from '../server/dist/domains/codingRuntime/store.js';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'poc42-'));
const repo = path.join(root, 'repo');
fs.mkdirSync(repo);
execFileSync('git', ['init', '-b', 'main'], { cwd: repo, stdio: 'ignore', windowsHide: true });
execFileSync('git', ['config', 'user.email', 'poc@agentic.local'], { cwd: repo, stdio: 'ignore', windowsHide: true });
execFileSync('git', ['config', 'user.name', 'POC'], { cwd: repo, stdio: 'ignore', windowsHide: true });
fs.writeFileSync(path.join(repo, 'demo.js'), 'module.exports = { x: 1 };\n');
execFileSync('git', ['add', '.'], { cwd: repo, stdio: 'ignore', windowsHide: true });
execFileSync('git', ['commit', '-qm', 'init'], { cwd: repo, stdio: 'ignore', windowsHide: true });

const service = new CodingRuntimeService(async () => ({}));
const run = await service.startRun({
  taskId: 'poc42-task',
  projectId: 'proj-poc42',
  projectTaskId: 'pt-poc42',
  workspace: repo,
  instructions: 'Create a file notes.md with at least 200 lines of content describing the history of computing, one line per item. Be thorough.',
  acceptanceCriteria: 'notes.md created with substantial content',
  providerPolicy: getCodingPolicy('default'),
  allowedCommands: [],
  timeoutMs: 240000,
});
console.log('RUN', run.runId, run.status);

// Give codex a moment to actually start (worktree + spawn + begin writing).
await new Promise((r) => setTimeout(r, 10000));
const mid = getCodingRun(run.runId);
console.log('MID_STATUS', mid?.status, 'attempts', mid?.providerAttempts.length);

const cancelled = service.cancelRun(run.runId);
console.log('CANCEL_RESULT', cancelled?.status, cancelled?.cancellationReason);
await new Promise((r) => setTimeout(r, 2000));
const after = getCodingRun(run.runId);
console.log('AFTER_CANCEL', after?.status);
console.log('WORKTREE_INTACT', after?.worktreePath ? fs.existsSync(after.worktreePath) : 'none');
console.log('NO_FALLBACK', after?.fallbackHistory.length === 0);
console.log('ATTEMPTS', JSON.stringify(after?.providerAttempts.map((a) => ({ provider: a.provider, outcome: a.outcome }))));

// New run still works afterward.
const run2 = await service.startRun({
  taskId: 'poc42-task2',
  projectId: 'proj-poc42',
  projectTaskId: 'pt-poc42b',
  workspace: repo,
  instructions: 'Append a line "// second run" to demo.js.',
  acceptanceCriteria: 'appended',
  providerPolicy: getCodingPolicy('default'),
  allowedCommands: [],
  timeoutMs: 120000,
});
console.log('RUN2_CREATED', run2.runId);
for (let i = 0; i < 30; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  const s = getCodingRun(run2.runId);
  if (s && ['awaiting_review', 'completed', 'failed', 'cancelled'].includes(s.status)) {
    console.log('RUN2_STATUS', s.status, 'changed', JSON.stringify(s.changedFiles));
    break;
  }
}
console.log('RUNS_TOTAL', listCodingRuns().length);
