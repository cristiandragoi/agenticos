// P10 — single-provider Codex Builder POC (real Codex CLI, OpenAI provider).
// Creates a temp repo, runs the coding runtime end-to-end: worktree isolation,
// codex exec, diff capture, verifier, awaiting_review. No merge, no deploy.
import { CodingRuntimeService } from '../server/dist/domains/codingRuntime/service.js';
import { getCodingPolicy } from '../server/dist/domains/codingRuntime/providerPolicy.js';
import { getCodingRun } from '../server/dist/domains/codingRuntime/store.js';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'poc10-'));
const repo = path.join(root, 'repo');
fs.mkdirSync(repo);
execFileSync('git', ['init', '-b', 'main'], { cwd: repo, stdio: 'ignore', windowsHide: true });
execFileSync('git', ['config', 'user.email', 'poc@agentic.local'], { cwd: repo, stdio: 'ignore', windowsHide: true });
execFileSync('git', ['config', 'user.name', 'POC'], { cwd: repo, stdio: 'ignore', windowsHide: true });
fs.writeFileSync(path.join(repo, 'demo.js'), 'function add(a, b) { return a + b; }\nmodule.exports = { add };\n');
fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ name: 'poc10', private: true, scripts: { test: 'node test.js' } }, null, 2));
fs.writeFileSync(path.join(repo, 'test.js'), 'const { add } = require("./demo.js");\nif (add(1, 2) !== 3) throw new Error("add failed");\nconsole.log("ALL TESTS PASS");\n');
execFileSync('git', ['add', '.'], { cwd: repo, stdio: 'ignore', windowsHide: true });
execFileSync('git', ['commit', '-qm', 'init'], { cwd: repo, stdio: 'ignore', windowsHide: true });
const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8', windowsHide: true }).trim();
console.log('BASE', base);

const service = new CodingRuntimeService(async () => ({})); // openai uses existing auth, no scoped env needed
const run = await service.startRun({
  taskId: 'poc10-task',
  projectId: 'proj-poc10',
  projectTaskId: 'pt-poc10',
  workspace: repo,
  instructions: 'Add a function subtract(a, b) to demo.js and export it. Update test.js to assert subtract(5, 2) === 3. Run the test command and make sure it passes.',
  acceptanceCriteria: 'demo.js exports subtract; test.js asserts subtract(5,2)===3; test command exits 0.',
  providerPolicy: getCodingPolicy('default'),
  allowedCommands: ['node test.js'],
  timeoutMs: 240000,
});
console.log('RUN_CREATED', run.runId, run.status);

// Poll until terminal.
let stored = null;
for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  stored = getCodingRun(run.runId);
  if (stored && ['awaiting_review', 'completed', 'failed', 'cancelled'].includes(stored.status)) break;
}
if (!stored) { console.log('NO_RUN'); process.exit(1); }
console.log('FINAL_STATUS', stored.status);
console.log('PROVIDER_ATTEMPTS', JSON.stringify(stored.providerAttempts.map((a) => ({ provider: a.provider, outcome: a.outcome, failureClass: a.failureClass }))));
console.log('WORKTREE', stored.worktreePath);
console.log('BRANCH', stored.branch);
console.log('CHANGED_FILES', JSON.stringify(stored.changedFiles));
console.log('DIFF_REF_LEN', stored.diffRef?.length || 0);
console.log('TEST_RESULTS', JSON.stringify(stored.testResults));
console.log('VERIFIER', stored.verifierVerdict, stored.verifierProvenance);
console.log('COMMANDS', stored.commands.length);
console.log('CHECKPOINTS', JSON.stringify(stored.checkpoints.map((c) => c.phase)));

// Protected checkout unchanged?
const parentStatus = execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8', windowsHide: true }).trim();
const parentHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8', windowsHide: true }).trim();
console.log('PARENT_DIRTY', parentStatus !== '');
console.log('PARENT_HEAD_UNCHANGED', parentHead === base);
console.log('NO_MERGE', !stored.metadata?.merged);

// Show the actual diff content briefly.
if (stored.diffRef) {
  const lines = stored.diffRef.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).slice(0, 8);
  console.log('DIFF_SAMPLE', JSON.stringify(lines));
}
