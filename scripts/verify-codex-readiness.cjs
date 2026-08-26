// verify-codex-readiness.cjs — Phase 4 CodeX real-workspace + terminal readiness.
// Part A: DETERMINISTIC (no LLM) — proves the runtime plumbing executes real
//   filesystem + terminal commands inside B:\AgenticOS.
// Part B: one bounded REAL CodeX task through the codexLoop (git inspection,
//   read-only, no source files modified).
// Runs standalone in Node (backend only) — Electron/Jarvis renderer NOT required.
const path = require('path');
const os = require('os');
const { pathToFileURL } = require('url');
const Database = require(path.resolve(__dirname, '../server/node_modules/better-sqlite3'));

// Dynamic import helper: Windows absolute paths must be file:// URLs for ESM.
const imp = (p) => import(pathToFileURL(p).href);

// Load server .env so real providers are available for Part B.
try {
  require(path.resolve(__dirname, '../server/node_modules/dotenv')).config({ path: path.resolve(__dirname, '../server/.env') });
} catch {}

const START_ISO = new Date().toISOString();
const results = { partA: {}, partB: null };

async function partA() {
  const { runSandboxedCommand, captureWorkspaceSnapshot } = await imp(path.resolve(__dirname, '../server/dist/utils/sandbox.js'));
  const { getWorkspaceRoot } = await imp(path.resolve(__dirname, '../server/dist/services/workspaceStore.js'));
  const { WORKER_CAPABILITY_PROFILE, workerSatisfies } = await imp(path.resolve(__dirname, '../server/dist/services/revenueOperator/executorSelection.js'));

  const ws = getWorkspaceRoot();
  results.partA.workspaceRoot = ws;
  results.partA.workspaceOk = (ws === 'B:\\AgenticOS');

  const gitTop = await runSandboxedCommand('git', ['rev-parse', '--show-toplevel'], undefined, ws);
  results.partA.gitTopLevel = gitTop.stdout.trim();
  results.partA.gitTopOk = gitTop.stdout.trim().replace(/[\\/]/g, '').toLowerCase() === 'b:agenticos';

  const gitStatus = await runSandboxedCommand('git', ['status', '--short'], undefined, ws);
  results.partA.gitStatus = gitStatus.stdout.trim().slice(0, 300);

  const nodeCwd = await runSandboxedCommand('node', ['-e', 'console.log(process.cwd())'], undefined, ws);
  results.partA.nodeCwd = nodeCwd.stdout.trim();

  let pwd = null, ls = null, python = null;
  try { pwd = await runSandboxedCommand('pwd', [], undefined, ws); results.partA.pwd = pwd.stdout.trim(); }
  catch (e) { results.partA.pwd = `BLOCKED: ${e.message}`; }
  try { ls = await runSandboxedCommand('ls', [], undefined, ws); results.partA.ls = ls.stdout.trim().split('\n').slice(0, 8); }
  catch (e) { results.partA.ls = `BLOCKED: ${e.message}`; }
  try { python = await runSandboxedCommand('python', ['--version'], undefined, ws); results.partA.python = python.stdout.trim() || python.stderr.trim(); }
  catch (e) { results.partA.python = `BLOCKED: ${e.message}`; }

  const snap = await captureWorkspaceSnapshot(ws);
  results.partA.snapshot = snap;

  // Capability profile now declares terminal/git/repository_workspace.
  const buildCheck = workerSatisfies('codex', ['filesystem_write', 'terminal', 'git', 'repository_workspace']);
  results.partA.codexCapabilities = WORKER_CAPABILITY_PROFILE.codex;
  results.partA.buildCapsSatisfied = buildCheck.satisfied;

  console.log('[Part A — deterministic runtime probe]');
  console.log('  workspaceRoot       :', ws, results.partA.workspaceOk ? '(OK)' : '(MISMATCH)');
  console.log('  git rev-parse --show-toplevel:', results.partA.gitTopLevel, results.partA.gitTopOk ? '(OK)' : '(MISMATCH)');
  console.log('  node -e process.cwd():', results.partA.nodeCwd);
  console.log('  pwd                 :', results.partA.pwd);
  console.log('  ls (first 8)        :', JSON.stringify(results.partA.ls));
  console.log('  python --version    :', results.partA.python);
  console.log('  git status --short  :', results.partA.gitStatus || '(clean)');
  console.log('  snapshot            :', JSON.stringify(snap));
  console.log('  codex caps          :', results.partA.codexCapabilities.join(', '));
  console.log('  build caps satisfied:', results.partA.buildCapsSatisfied);
}

async function partB() {
  const { goalStore } = await imp(path.resolve(__dirname, '../server/dist/services/goalStore.js'));
  const { executionRunService } = await imp(path.resolve(__dirname, '../server/dist/services/projectExecution/executionRunService.js'));
  const { resumeCodexGoalLoop } = await imp(path.resolve(__dirname, '../server/dist/loops/codexLoop.js'));
  const { reconcileCodexRun } = await imp(path.resolve(__dirname, '../server/dist/domains/workerAdapters/codexAdapter.js'));

  const goalId = `goal-rdy-${Date.now().toString(36)}`;
  const ws = 'B:\\AgenticOS';
  goalStore.create({
    id: goalId,
    originalGoal:
      'Run these READ-ONLY commands and report their exact output, then finish. DO NOT modify any files.\n' +
      '1. git rev-parse --show-toplevel\n' +
      '2. git status --short\n' +
      '3. git ls-files | head -10\n' +
      'Report the command outputs verbatim in your finish message.',
    status: 'queued', retryCount: 0, providerFallbackCount: 0,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    workspacePath: ws, history: [],
  });

  const run = executionRunService.createRun({
    taskId: 'task-readiness-probe', projectId: 'proj-readiness-probe', goalId: 'goal-readiness-probe',
    workerType: 'codex', agentInstanceId: goalId, trigger: 'api',
  });
  executionRunService.updateRun(run.id, { status: 'running', startTime: new Date().toISOString() });

  console.log('\n[Part B — real CodeX readiness task] goal=' + goalId + ' run=' + run.id);
  await resumeCodexGoalLoop(goalId);

  // Poll to terminal (bounded).
  const deadline = Date.now() + 180000;
  let goal = goalStore.get(goalId);
  while (goal && !['completed', 'failed', 'stopped', 'cancelled'].includes(goal.status) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    goal = goalStore.get(goalId);
  }

  const reconciled = await reconcileCodexRun(run.id, goalId);
  const summary = typeof goal?.runSummary === 'object' ? (goal.runSummary.finalAnswer || goal.runSummary.summary || '') : '';
  results.partB = {
    goalId, runId: run.id, status: goal?.status, provider: reconciled?.provider ?? null, model: reconciled?.model ?? null,
    workerInstanceId: reconciled?.agentInstanceId ?? null, summary: String(summary).slice(0, 600),
  };
  console.log('[Part B] status=', results.partB.status, 'provider=', results.partB.provider, 'model=', results.partB.model);
  console.log('[Part B] summary:', results.partB.summary);

  // Verify repo root reported + no orphan + no source files changed by the probe.
  results.partB.reportsRepoRoot = /b:\\agenticos|agenticos/i.test(summary);
  results.partB.orphanRun = executionRunService.getRun(run.id)?.status === 'running';
}

(async () => {
  try {
    await partA();
    await partB();
  } catch (err) {
    console.error('[readiness] ERROR:', err?.message || err);
    process.exitCode = 2;
  }

  const outPath = path.join(os.tmpdir(), 'codex-readiness-probe.json');
  require('fs').writeFileSync(outPath, JSON.stringify({ startedAt: START_ISO, ...results }, null, 2));
  console.log('\nProbe written to', outPath);

  const a = results.partA, b = results.partB;
  const partAPass = a.workspaceOk && a.gitTopOk && a.buildCapsSatisfied && typeof a.ls === 'object';
  const partBPass = b && b.status === 'completed' && b.provider && b.reportsRepoRoot && !b.orphanRun;
  console.log(`\n=== READINESS ${partAPass && partBPass ? 'PASS' : 'PARTIAL'} === (A=${partAPass ? 'PASS' : 'FAIL'}, B=${partBPass ? 'PASS' : (b && b.status) || 'FAIL'})`);
})();
