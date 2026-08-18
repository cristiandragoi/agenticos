// Live DeepSeek Codex spike — through the DEPLOYED backend (keytar in-process).
// 1. Create a small git repo on disk.
// 2. POST /api/coding/runs with policy=deepseek-spike + spike overrides.
// 3. Poll to terminal; print results (never the key).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = 'http://127.0.0.1:4000';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-spike-live-'));
const repo = path.join(root, 'repo');
fs.mkdirSync(repo);
execFileSync('git', ['init', '-b', 'main'], { cwd: repo, stdio: 'ignore', windowsHide: true });
execFileSync('git', ['config', 'user.email', 'spike@agentic.local'], { cwd: repo, stdio: 'ignore', windowsHide: true });
execFileSync('git', ['config', 'user.name', 'Spike'], { cwd: repo, stdio: 'ignore', windowsHide: true });
fs.writeFileSync(path.join(repo, 'math.js'), 'function double(n) { return n * 2; }\nmodule.exports = { double };\n');
fs.writeFileSync(path.join(repo, 'test.js'), 'const { double } = require("./math.js");\nif (double(3) !== 6) throw new Error("fail");\nconsole.log("TESTS PASS");\n');
execFileSync('git', ['add', '.'], { cwd: repo, stdio: 'ignore', windowsHide: true });
execFileSync('git', ['commit', '-qm', 'init'], { cwd: repo, stdio: 'ignore', windowsHide: true });
console.log('REPO', repo);

const res = await fetch(`${BASE}/api/coding/runs`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    taskId: 'ds-spike-task', projectId: 'proj-ds-spike', projectTaskId: 'pt-ds-spike',
    workspace: repo,
    instructions: 'Add a function triple(n) that returns n * 3 to math.js and export it. Update test.js to assert triple(4) === 12. Run node test.js.',
    acceptanceCriteria: 'triple exported; test asserts triple(4)===12; node test.js exits 0.',
    policy: 'deepseek-spike',
    spike: { deepseekModel: 'deepseek-chat' },
    allowedCommands: ['node test.js'],
    timeoutMs: 300000,
  }),
});
const body = await res.json();
console.log('START', JSON.stringify(body));
const runId = body.runId;
if (!runId) { console.log('NO_RUN_ID'); process.exit(1); }

for (let i = 0; i < 45; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  const g = await (await fetch(`${BASE}/api/coding/runs/${runId}`)).json();
  if (['awaiting_review', 'completed', 'failed', 'cancelled'].includes(g.status)) {
    console.log('FINAL_STATUS', g.status);
    console.log('ATTEMPTS', JSON.stringify(g.providerAttempts.map((a) => ({ provider: a.provider, outcome: a.outcome, failureClass: a.failureClass, failureReason: (a.failureReason || '').slice(0, 200) }))));
    console.log('CHANGED', JSON.stringify(g.changedFiles));
    console.log('TEST', JSON.stringify(g.testResults));
    console.log('VERIFIER', g.verifierVerdict, g.verifierProvenance);
    console.log('CHECKPOINTS', JSON.stringify(g.checkpoints.map((c) => c.phase)));
    console.log('ERRORS', JSON.stringify(g.errors));
    break;
  }
  if (i === 44) console.log('POLL_TIMEOUT status=', g.status);
}
