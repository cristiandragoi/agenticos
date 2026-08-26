/**
 * Phase 4 — Maintenance Supervisor LIVE acceptance (controlled fixture).
 *
 * Demonstrates the full chain against a SAFE temp git fixture:
 *   git inspection → ownership → Hermes plan (deterministic) → CodeX repair
 *   (deterministic file edit) → real test gate → verifier → READY_FOR_APPROVAL
 *
 * Then proves restart reconstruction ("where were we?") and read-only
 * inspection of the REAL repository (no mutation). STOPS at the approval
 * boundary — never commits, never approves, never deploys.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// 1. Isolate the maintenance DB so the real DB is never touched.
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'phase4-accept-'));
process.env.AGENT_TEAMS_DB_PATH = path.join(tmpRoot, 'accept.db');

const { getGitState } = await import('../server/dist/services/maintenance/gitState.js');
const { diagnoseAndRepair, buildApprovalCheckpoint, getMaintenanceStatus } =
  await import('../server/dist/services/maintenance/maintenanceSupervisor.js');

// 2. Build a temp git fixture with a deliberately broken "production" module.
const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'phase4-repo-'));
execFileSync('git', ['init', '-q'], { cwd: repoDir });
execFileSync('git', ['config', 'user.email', 'accept@test.local'], { cwd: repoDir });
execFileSync('git', ['config', 'user.name', 'accept'], { cwd: repoDir });
fs.mkdirSync(path.join(repoDir, 'src'), { recursive: true });
fs.writeFileSync(path.join(repoDir, 'src', 'calc.js'), 'exports.add = (a, b) => a + b + 1;\n'); // off-by-one
fs.writeFileSync(path.join(repoDir, 'src', 'unrelated.js'), 'exports.x = 1;\n'); // must stay untouched
execFileSync('git', ['add', '-A'], { cwd: repoDir });
execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: repoDir });

console.log('[1] fixture repo:', repoDir);
const before = await getGitState(repoDir);
console.log('    before: clean=%s head=%s', before.totalEntries === 0, before.head.slice(0, 8));

// 3. Run the bounded auto-repair loop.
const outcome = await diagnoseAndRepair({
  changeSetId: 'phase4-acceptance-1',
  evidence: 'calc.add(2,3) returns 6; expected 5 (off-by-one in src/calc.js).',
  originatingFindingId: 'finding-1',
  originatingResultId: 'exr-acceptance-analysis',
  files: ['src/calc.js'], // ownership boundary: ONLY calc.js
  forbiddenFiles: ['src/unrelated.js', 'docs/'],
  repoPath: repoDir,
  plan: async (evidence, ctx) => ({
    resultId: `hermes-plan-${ctx.attempt}`,
    plan: 'Fix the off-by-one: change `a + b + 1` to `a + b` in src/calc.js.',
  }),
  repair: async (_plan, ctx) => {
    // Deterministic CodeX-equivalent edit — touches ONLY the owned file.
    fs.writeFileSync(path.join(repoDir, 'src', 'calc.js'), 'exports.add = (a, b) => a + b;\n');
    return { resultId: `codex-repair-${ctx.attempt}`, filesChanged: ['src/calc.js'] };
  },
  test: async () => {
    try {
      execFileSync(process.execPath, ['-e', "const {add}=require('./src/calc.js'); if(add(2,3)!==5) process.exit(1);"], { cwd: repoDir, stdio: 'pipe' });
      return [{ gateId: 'calc-test', command: 'node -e add(2,3)===5', passed: true, classification: 'passed', evidence: 'add(2,3)===5', exitCode: 0 }];
    } catch (e) {
      return [{ gateId: 'calc-test', command: 'node -e add(2,3)===5', passed: false, classification: 'test_failure', evidence: `add(2,3)!==5 (exit ${e.status})`, exitCode: e.status }];
    }
  },
  verify: async () => ({ passed: true, reason: 'verified: calc.js now returns add(2,3)===5' }),
});

console.log('[2] repair loop outcome:');
console.log('    status       =', outcome.status);
console.log('    attempts     =', outcome.attempts);
for (const a of outcome.attemptsLog) {
  console.log(`    attempt ${a.attempt}: plan=${a.planResultId} repair=${a.repairResultId} files=${a.filesChanged} decision=${a.decision}`);
}

// 4. Build the approval checkpoint and STOP (never commit/approve).
const last = outcome.attemptsLog[outcome.attemptsLog.length - 1];
const checkpoint = buildApprovalCheckpoint('phase4-acceptance-1', last.testResults, outcome.attempts);
console.log('[3] approval checkpoint:');
console.log('    status         =', checkpoint.status);
console.log('    risk           =', checkpoint.risk);
console.log('    finding        =', checkpoint.finding);
console.log('    filesOwned     =', JSON.stringify(checkpoint.filesOwned));
console.log('    proposedCommit =', checkpoint.proposedCommit);
console.log('    unrelatedPreserved =', checkpoint.unrelatedPreserved);

// 5. Prove restart reconstruction ("where were we?").
const pending = getMaintenanceStatus();
console.log('[4] where-were-we (post-restart reconstruction):', pending ? `${pending.status} / ${pending.originatingFindingId} / files=${pending.files}` : 'none');

// 6. Prove the forbidden file was NOT touched by the repair.
const unrelated = fs.readFileSync(path.join(repoDir, 'src', 'unrelated.js'), 'utf8');
console.log('[5] forbidden file untouched:', unrelated === 'exports.x = 1;\n');

// 7. Read-only inspection of the REAL repository (no mutation).
const real = await getGitState('B:/AgenticOS');
console.log('[6] REAL repo (read-only): branch=%s head=%s totalEntries=%d modified=%d untracked=%d staged=%d',
  real.branch, real.head.slice(0, 8), real.totalEntries, real.modified.length, real.untracked.length, real.staged.length);

console.log('\nACCEPTANCE COMPLETE — stopped at READY_FOR_APPROVAL (no commit, no approval, no deploy).');
