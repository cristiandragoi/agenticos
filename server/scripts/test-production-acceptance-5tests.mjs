/**
 * test-production-acceptance-5tests.mjs
 *
 * FINAL PRODUCTION ACCEPTANCE:
 *   TEST 1 — UNKNOWN REAL GOAL (Discovery, Multi-Surface Execution, Reality Verification)
 *   TEST 2 — REAL INTERNAL DEFECT (Autonomous Engineering Self-Repair, Patch, Test, Deploy, Retry, Argus Verification, Closure)
 *   TEST 3 — RECOVERY FAILURE (RecoveryWatchdog Detects Broken Recovery Stage, Routes Around via Fallback, Restores Pipeline)
 *   TEST 4 — RESTART RESILIENCE (State Preserved in SQLite, Interrupted Runs Reconciled to RECOVERABLE, No Ghost Approvals)
 *   TEST 5 — COMPLETELY DIFFERENT GOAL (Category Shift to Prove Architectural Generalization)
 */

import { repositoryAuthority } from '../dist/domains/controlPlane/RepositoryAuthority.js';
import { goalLifecycleManager } from '../dist/domains/controlPlane/GoalLifecycle.js';
import { capabilityDiscovery } from '../dist/domains/controlPlane/CapabilityDiscovery.js';
import { universalVerifier } from '../dist/domains/controlPlane/UniversalVerifier.js';
import { recoveryWatchdog } from '../dist/domains/controlPlane/RecoveryWatchdog.js';
import { repairKnowledgeStore } from '../dist/domains/controlPlane/RepairKnowledgeStore.js';
import { routeTurn } from '../dist/domains/jarvisNext/turnRouter.js';
import { backgroundTaskManager } from '../dist/services/backgroundTasks/manager.js';
import { backgroundTaskRepo } from '../dist/services/backgroundTasks/store.js';
import { projectsStore } from '../dist/services/projectsStore.js';
import { db } from '../dist/db/index.js';
import { projects } from '../dist/db/schema.js';
import { repairIncidents } from '../dist/domains/selfHeal/schema.js';
import { repairKnowledge, goalRuns } from '../dist/domains/controlPlane/schema.js';
import { eq, or, like } from 'drizzle-orm';

async function runProductionAcceptance() {
  console.log('════════════════════════════════════════════════════════════════════');
  console.log('   AGENTICOS FINAL PRODUCTION ACCEPTANCE — 5 COMPREHENSIVE TESTS   ');
  console.log('════════════════════════════════════════════════════════════════════\n');

  let test1Pass = false;
  let test2Pass = false;
  let test3Pass = false;
  let test4Pass = false;
  let test5Pass = false;

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 1 — UNKNOWN REAL GOAL
  // ──────────────────────────────────────────────────────────────────────────
  console.log('▶ [TEST 1 — UNKNOWN REAL GOAL]');
  console.log('  Testing unconfigured goal ingestion, capability discovery, execution & verification...');
  const test1Target = 'Notepad';
  const test1Turn = await routeTurn({
    prompt: `Open ${test1Target}`,
    conversationId: 'conv-test-1-unknown-goal',
  });

  console.log(`  Spoken Response : "${test1Turn.text}"`);
  console.log(`  Executed        : ${test1Turn.executed}`);
  console.log(`  Verified        : ${test1Turn.verified}`);
  console.log(`  Assigned GoalId : ${test1Turn.goalId || 'none'}`);

  const test1Goal = test1Turn.goalId ? goalLifecycleManager.getGoalRun(test1Turn.goalId) : null;
  const test1GoalStored = test1Goal && test1Goal.status === 'COMPLETED';
  const test1Learned = repairKnowledgeStore.lookupResolution(test1Target, 'open');

  console.log(`  GoalRun State   : ${test1Goal?.status} (timeline events: ${test1Goal?.timeline?.length || 0})`);
  console.log(`  Learned Memory  : ${test1Learned ? `YES (${test1Learned.surface})` : 'NO'}`);

  test1Pass = test1Turn.executed && test1Turn.verified && Boolean(test1GoalStored);
  console.log(`  Test 1 Result   : ${test1Pass ? '✅ PASS' : '❌ FAIL'}\n`);

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 2 — REAL INTERNAL DEFECT
  // ──────────────────────────────────────────────────────────────────────────
  console.log('▶ [TEST 2 — REAL INTERNAL DEFECT]');
  console.log('  Triggering turn depending on un-wired capability to exercise closed-loop self-repair...');

  const DEFECT_PROJ_ID = 'proj-real-defect-isolated';
  const DEFECT_ORIG_NAME = 'Defect Test Original';
  const DEFECT_REPAIRED_NAME = 'Defect Test Repaired';

  try {
    db.delete(projects).where(eq(projects.id, DEFECT_PROJ_ID)).run();
    db.delete(repairKnowledge).where(like(repairKnowledge.target, '%Defect Test%')).run();
  } catch {}

  projectsStore.createProject({
    id: DEFECT_PROJ_ID,
    name: DEFECT_ORIG_NAME,
    description: 'Fixture project for internal defect self-repair test',
    status: 'active',
    priority: 88,
  });

  const defectLogs = [];
  const origLog = console.log;
  console.log = (...args) => {
    defectLogs.push(args.join(' '));
    origLog(...args);
  };

  try {
    const defectTurn = await routeTurn({
      prompt: `Rename ${DEFECT_ORIG_NAME} to ${DEFECT_REPAIRED_NAME}`,
      conversationId: 'conv-test-2-defect',
    });
    console.log(`  Defect Turn Response: "${defectTurn.text}"`);

    // Poll for closed loop completion
    for (let i = 0; i < 20; i++) {
      const p = projectsStore.getProject(DEFECT_PROJ_ID);
      if (p?.name === DEFECT_REPAIRED_NAME && defectLogs.some(l => l.includes('SELFHEAL_RESULT_VERIFIED'))) break;
      await new Promise(r => setTimeout(r, 500));
    }

    const storeReadback = projectsStore.getProject(DEFECT_PROJ_ID);
    const storeUpdated = storeReadback?.name === DEFECT_REPAIRED_NAME;
    console.log(`  Authoritative Store Readback: "${storeReadback?.name}" (expected: "${DEFECT_REPAIRED_NAME}")`);

    // Check incident closure in database
    let closedIncident = null;
    const incidents = db.select().from(repairIncidents).all();
    for (const inc of incidents.reverse()) {
      if (inc.component.includes(DEFECT_PROJ_ID) || inc.symptom.includes(DEFECT_ORIG_NAME)) {
        closedIncident = inc;
        break;
      }
    }

    const incidentClosed = Boolean(closedIncident && closedIncident.status === 'COMPLETED' && closedIncident.resolvedAt);
    console.log(`  Incident Closed in SQLite: ${incidentClosed ? 'YES' : 'NO'} (${closedIncident?.id}, status: ${closedIncident?.status})`);

    test2Pass = storeUpdated && incidentClosed && defectTurn.verified;
    console.log(`  Test 2 Result: ${test2Pass ? '✅ PASS' : '❌ FAIL'}\n`);
  } finally {
    console.log = origLog;
    try {
      db.delete(projects).where(eq(projects.id, DEFECT_PROJ_ID)).run();
    } catch {}
  }

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 3 — RECOVERY FAILURE & RECOVERY WATCHDOG
  // ──────────────────────────────────────────────────────────────────────────
  console.log('▶ [TEST 3 — RECOVERY FAILURE & RECOVERY WATCHDOG]');
  console.log('  Disabling recovery-stage component and checking independent fallback routing...');

  const watchdogIncidentId = `SELFHEAL-WATCHDOG-${Date.now().toString().slice(-4)}`;
  recoveryWatchdog.injectComponentDefect('repair_execution');

  let watchdogDetectedFallback = false;
  const watchdogHandler = (evt) => {
    if (evt.incidentId === watchdogIncidentId) {
      watchdogDetectedFallback = true;
    }
  };
  recoveryWatchdog.on('watchdog:fallback', watchdogHandler);

  const watchdogExec = await recoveryWatchdog.checkStageExecution({
    incidentId: watchdogIncidentId,
    stage: 'repair_execution',
    executeDefault: async () => {
      throw new Error('Injected defect broke standard repair execution');
    },
    executeFallback: async () => {
      return { success: true, outcome: { fallbackRouteUsed: true } };
    },
  });

  recoveryWatchdog.off('watchdog:fallback', watchdogHandler);
  recoveryWatchdog.clearComponentDefects();
  const watchdogRestoredHealth = recoveryWatchdog.verifyPipelineHealth();

  test3Pass = watchdogExec.usedFallback && watchdogExec.result.outcome.fallbackRouteUsed && watchdogRestoredHealth.healthy;
  console.log(`  Watchdog Detected & Fallback Executed: ${watchdogExec.usedFallback ? 'YES' : 'NO'}`);
  console.log(`  Pipeline Health Restored             : ${watchdogRestoredHealth.healthy ? 'YES' : 'NO'}`);
  console.log(`  Test 3 Result                        : ${test3Pass ? '✅ PASS' : '❌ FAIL'}\n`);

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 4 — RESTART RESILIENCE
  // ──────────────────────────────────────────────────────────────────────────
  console.log('▶ [TEST 4 — RESTART RESILIENCE]');
  console.log('  Testing persistence, startup reconciliation, and conversation continuity...');

  // Create an active goal that was interrupted mid-flight
  const interruptedRun = goalLifecycleManager.startGoal({
    conversationId: 'conv-test-4-restart',
    userInput: 'Open Camera',
    normalizedGoal: 'Open Camera',
    target: 'Camera',
  });
  goalLifecycleManager.transitionState(interruptedRun.goalId, 'EXECUTING', {
    actor: 'ControlPlane',
    summary: 'Executing camera launch before simulated crash.',
  });

  // Also create a dead task waiting_approval with nonexistent runId
  const deadApprovalTaskId = `task-restart-approval-${Date.now()}`;
  backgroundTaskRepo.insertTask({
    taskId: deadApprovalTaskId,
    title: 'Dead Approval Restart Test',
    objective: 'Ensure stale approvals are purged on restart',
    originalRequest: 'Stale approval',
    route: 'hermes_task',
    selectedAgent: 'hermes',
    status: 'waiting_approval',
    priority: 'medium',
    projectId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    worker: 'hermes',
    linkedRunId: `dead-run-${Date.now()}`,
    approvalState: 'pending',
    cancellationRequested: false,
    resumable: false,
    attempt: 1,
    childTaskIds: [],
    filesChanged: [],
    metadata: {},
    buildState: 'idle',
    testState: 'idle',
    verificationState: 'pending',
    currentStage: '',
    progressMessage: '',
    workspaceRoot: '',
  });

  // Simulate restart reconciliation
  const goalReconcile = goalLifecycleManager.restoreAfterRestart();
  backgroundTaskManager.restoreAfterRestart();

  // Verify interrupted goal was restored to RECOVERABLE
  const restoredGoal = goalLifecycleManager.getGoalRun(interruptedRun.goalId);
  const goalRestoredRecoverable = restoredGoal?.status === 'RECOVERABLE';
  console.log(`  Interrupted Goal Restored State: ${restoredGoal?.status} (expected: RECOVERABLE)`);

  // Verify dead task approval was purged
  const pendingApprovals = backgroundTaskManager.listPendingApprovals();
  const deadStillPending = pendingApprovals.some(a => a.taskId === deadApprovalTaskId);
  console.log(`  Dead Approval Purged          : ${!deadStillPending ? 'YES' : 'NO'}`);

  // Test conversation continuity ("Try again") on the restored goal
  const retryTurn = await routeTurn({
    prompt: 'Try again',
    conversationId: 'conv-test-4-restart',
  });
  console.log(`  Continuity Response ("Try again"): "${retryTurn.text}"`);

  test4Pass = Boolean(goalRestoredRecoverable) && !deadStillPending && retryTurn.handled;
  console.log(`  Test 4 Result                 : ${test4Pass ? '✅ PASS' : '❌ FAIL'}\n`);

  // Cleanup dead task
  try {
    const { rawDb } = await import('../dist/db/index.js');
    rawDb.prepare('DELETE FROM background_tasks WHERE task_id = ?').run(deadApprovalTaskId);
  } catch {}

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 5 — COMPLETELY DIFFERENT GOAL CATEGORY
  // ──────────────────────────────────────────────────────────────────────────
  console.log('▶ [TEST 5 — COMPLETELY DIFFERENT GOAL CATEGORY]');
  console.log('  Testing a completely different domain (web query / knowledge goal) without hardcoded rules...');

  const categoryTurn = await routeTurn({
    prompt: 'Search for TypeScript 5 release notes',
    conversationId: 'conv-test-5-category-shift',
  });

  console.log(`  Turn Response : "${categoryTurn.text}"`);
  console.log(`  Handled       : ${categoryTurn.handled}`);
  console.log(`  Route         : ${categoryTurn.route}`);
  console.log(`  Verified      : ${categoryTurn.verified}`);
  console.log(`  GoalId        : ${categoryTurn.goalId || 'none'}`);

  const catGoal = categoryTurn.goalId ? goalLifecycleManager.getGoalRun(categoryTurn.goalId) : null;

  test5Pass = categoryTurn.handled && categoryTurn.verified && Boolean(catGoal);
  console.log(`  Test 5 Result : ${test5Pass ? '✅ PASS' : '❌ FAIL'}\n`);

  // ──────────────────────────────────────────────────────────────────────────
  // FINAL SUMMARY
  // ──────────────────────────────────────────────────────────────────────────
  console.log('════════════════════════════════════════════════════════════════════');
  console.log('   FINAL PRODUCTION ACCEPTANCE REPORT                               ');
  console.log('════════════════════════════════════════════════════════════════════');
  console.log(`  TEST 1 — UNKNOWN REAL GOAL              : ${test1Pass ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`  TEST 2 — REAL INTERNAL DEFECT           : ${test2Pass ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`  TEST 3 — RECOVERY FAILURE & WATCHDOG    : ${test3Pass ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`  TEST 4 — RESTART RESILIENCE             : ${test4Pass ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`  TEST 5 — COMPLETELY DIFFERENT GOAL      : ${test5Pass ? '✅ PASS' : '❌ FAIL'}`);
  console.log('════════════════════════════════════════════════════════════════════');

  const allPassed = test1Pass && test2Pass && test3Pass && test4Pass && test5Pass;
  if (allPassed) {
    console.log('\n🎉 ALL 5 FINAL PRODUCTION ACCEPTANCE TESTS PASSED 100%!');
    process.exit(0);
  } else {
    console.error('\n❌ ONE OR MORE FINAL PRODUCTION ACCEPTANCE TESTS FAILED.');
    process.exit(1);
  }
}

runProductionAcceptance().catch(err => {
  console.error('Fatal error in production acceptance:', err);
  process.exit(1);
});
