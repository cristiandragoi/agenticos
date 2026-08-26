// verify-rg-acceptance.cjs — Phase: real CodeX `rg` execution acceptance.
// Part A (deterministic): runSandboxedCommand('rg', ...) is authorized + executable.
// Part B (real CodeX task through codexLoop): model runs `rg --version` and
//   `rg "WebGLRenderer" .` inside B:\AgenticOS, read-only, no file changes.
const path = require('path');
const os = require('os');
const { pathToFileURL } = require('url');
const imp = (p) => import(pathToFileURL(p).href);

try {
  require(path.resolve(__dirname, '../server/node_modules/dotenv')).config({ path: path.resolve(__dirname, '../server/.env') });
} catch {}

const WS = 'B:\\AgenticOS';
const results = { partA: {}, partB: null };

async function partA() {
  const { runSandboxedCommand } = await imp(path.resolve(__dirname, '../server/dist/utils/sandbox.js'));
  const ver = await runSandboxedCommand('rg', ['--version'], undefined, WS);
  results.partA.rgVersion = ver.stdout.trim();
  results.partA.rgVersionOk = /ripgrep/i.test(ver.stdout);

  const search = await runSandboxedCommand('rg', ['WebGLRenderer', '.'], undefined, WS);
  results.partA.rgSearchLines = search.stdout.trim().split('\n').filter(Boolean).length;
  results.partA.rgSearchOk = !/blocked by policy/i.test(search.stdout) && !/blocked by policy/i.test(search.stderr);
  results.partA.rgSearchPreview = search.stdout.trim().slice(0, 300);

  console.log('[Part A — deterministic rg probe]');
  console.log('  rg --version      :', results.partA.rgVersion, results.partA.rgVersionOk ? '(OK)' : '(FAIL)');
  console.log('  rg "WebGLRenderer" . :', results.partA.rgSearchLines, 'matching lines', results.partA.rgSearchOk ? '(OK)' : '(FAIL)');
  console.log('  preview:', results.partA.rgSearchPreview.replace(/\n/g, ' | '));
}

async function partB() {
  const { goalStore } = await imp(path.resolve(__dirname, '../server/dist/services/goalStore.js'));
  const { executionRunService } = await imp(path.resolve(__dirname, '../server/dist/services/projectExecution/executionRunService.js'));
  const { resumeCodexGoalLoop } = await imp(path.resolve(__dirname, '../server/dist/loops/codexLoop.js'));
  const { reconcileCodexRun } = await imp(path.resolve(__dirname, '../server/dist/domains/workerAdapters/codexAdapter.js'));

  const goalId = `goal-rg-${Date.now().toString(36)}`;
  goalStore.create({
    id: goalId,
    originalGoal:
      'Run these READ-ONLY commands in the workspace root and report their exact output, then finish. DO NOT modify any files.\n' +
      '1. rg --version\n' +
      '2. rg "WebGLRenderer" .\n' +
      'Report the command outputs verbatim in your finish message.',
    status: 'queued', retryCount: 0, providerFallbackCount: 0,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    workspacePath: WS, history: [],
  });

  const run = executionRunService.createRun({
    taskId: 'task-rg-probe', projectId: 'proj-rg-probe', goalId: 'goal-rg-probe',
    workerType: 'codex', agentInstanceId: goalId, trigger: 'api',
  });
  executionRunService.updateRun(run.id, { status: 'running', startTime: new Date().toISOString() });

  console.log('\n[Part B — real CodeX rg task] goal=' + goalId + ' run=' + run.id);
  await resumeCodexGoalLoop(goalId);

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
    workerInstanceId: reconciled?.agentInstanceId ?? null, summary: String(summary).slice(0, 800),
  };
  results.partB.ranRgVersion = /rg --version/i.test(summary);
  results.partB.ripgrepInOutput = /ripgrep/i.test(summary);
  results.partB.ranWebGLSearch = /WebGLRenderer/i.test(summary);
  results.partB.blockedByPolicy = /blocked by policy/i.test(summary);
  results.partB.orphanRun = executionRunService.getRun(run.id)?.status === 'running';

  console.log('[Part B] status=', results.partB.status, 'provider=', results.partB.provider, 'model=', results.partB.model);
  console.log('[Part B] summary:', results.partB.summary);
}

(async () => {
  try {
    await partA();
    await partB();
  } catch (err) {
    console.error('[rg-acceptance] ERROR:', err?.message || err);
    process.exitCode = 2;
  }

  require('fs').writeFileSync(path.join(os.tmpdir(), 'rg-acceptance.json'), JSON.stringify(results, null, 2));

  const a = results.partA, b = results.partB;
  const partAPass = a.rgVersionOk && a.rgSearchOk;
  const partBPass = b && b.status === 'completed' && b.provider && !b.blockedByPolicy && !b.orphanRun;
  console.log(`\n=== RG ACCEPTANCE ${partAPass && partBPass ? 'PASS' : 'PARTIAL'} === (A=${partAPass ? 'PASS' : 'FAIL'}, B=${partBPass ? 'PASS' : 'FAIL'})`);
})();
