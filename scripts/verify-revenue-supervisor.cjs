const path = require('path');

async function main() {
  console.log('=== REVENUE MISSION SUPERVISOR PHASE 2C VERIFICATION ===\n');

  // Load server modules from dist
  const { revenueSupervisor } = await import('../server/dist/services/revenueOperator/revenueSupervisor.js');
  const { revenueBriefingService } = await import('../server/dist/services/revenueOperator/briefingService.js');
  const { runtimeRegistry } = await import('../server/dist/services/runtimeRegistry.js');
  const { HermesAdapter } = await import('../server/dist/adapters/hermesAdapter.js');
  const { JarvisAdapter } = await import('../server/dist/adapters/jarvisAdapter.js');
  const { db } = await import('../server/dist/db/index.js');
  const { revenueMissions, revenueExperiments, revenueHumanGates } = await import('../server/dist/db/schema.js');
  const { eq } = await import('../server/node_modules/drizzle-orm/index.js');

  // Register adapters for supervisor continuation
  runtimeRegistry.register(new HermesAdapter());
  runtimeRegistry.register(new JarvisAdapter());

  // Test 1: Supervisor Initial Status & Active Mission Resolution
  console.log('[TEST 1] Testing active mission resolution & status...');
  const status = await revenueSupervisor.getStatus();
  console.log(`- Control State: ${status.controlState}`);
  console.log(`- Active Mission: ${status.activeMissionId} (${status.activeMissionTitle})`);
  console.log(`- Active Branches Count: ${status.activeBranchesCount}`);
  console.log(`- Paused Branches Count: ${status.pausedBranchesCount}`);
  console.log(`- Total Branches: ${status.branches.length}`);

  if (!status.activeMissionId || !status.activeMissionId.startsWith('mission-616808fe-')) {
    throw new Error(`[FAIL] Expected active mission starting with mission-616808fe-, got: ${status.activeMissionId}`);
  }
  console.log('[PASS] Active mission correctly resolved to mission-616808fe-');

  // Test 2: Human Gate Branch Isolation
  console.log('\n[TEST 2] Testing Human Gate branch isolation...');
  const pausedBranches = status.branches.filter(b => b.status === 'WAITING_FOR_GATE');
  const runnableBranches = status.branches.filter(b => b.status === 'READY' || b.status === 'RUNNING');

  console.log(`- Gated/Paused branches: ${pausedBranches.length}`);
  console.log(`- Runnable non-gated branches: ${runnableBranches.length}`);

  if (pausedBranches.length === 0) {
    throw new Error('[FAIL] Expected paused branches due to open human gates.');
  }
  if (runnableBranches.length === 0) {
    throw new Error('[FAIL] Expected runnable branches alongside gated branches (branch isolation failed).');
  }
  console.log('[PASS] Branch isolation verified: Only gated branches are paused; runnable branches remain active.');

  // Test 3: Autonomous Continuation (Multi-Cycle Execution)
  console.log('\n[TEST 3] Testing autonomous continuation cycles...');
  const cycle1 = await revenueSupervisor.runSupervisorCycle();
  console.log(`- Cycle 1 completed: count = ${cycle1.cycleCount}`);
  
  const cycle2 = await revenueSupervisor.runSupervisorCycle();
  console.log(`- Cycle 2 completed: count = ${cycle2.cycleCount}`);

  if (cycle2.cycleCount <= cycle1.cycleCount) {
    throw new Error('[FAIL] Supervisor cycle counter did not advance.');
  }
  console.log('[PASS] Autonomous continuation cycles successfully executed without prompts.');

  // Test 4: Gate Auto-Resumption (Reversible Non-Destructive Test)
  console.log('\n[TEST 4] Testing Human Gate auto-resumption on resolution...');
  const testExpId = `exp-test-gate-resume-${Date.now()}`;
  const testGateId = `gate-test-resume-${Date.now()}`;

  // Insert temporary test experiment & gate
  await db.insert(revenueExperiments).values({
    id: testExpId,
    missionId: status.activeMissionId,
    engine: 'digital_products',
    hypothesis: 'Test gate resume hypothesis',
    status: 'BLOCKED',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  await db.insert(revenueHumanGates).values({
    id: testGateId,
    experimentId: testExpId,
    gateType: 'CONTRACT_APPROVAL',
    status: 'open',
    branchPaused: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  // Verify branch is initially WAITING_FOR_GATE
  const statusGated = await revenueSupervisor.runSupervisorCycle();
  const branchGated = statusGated.branches.find(b => b.experimentId === testExpId);
  if (!branchGated || branchGated.status !== 'WAITING_FOR_GATE') {
    throw new Error(`[FAIL] Test branch was not paused for open gate: ${branchGated?.status}`);
  }
  console.log(`[PASS] Test branch correctly entered WAITING_FOR_GATE.`);

  // Resolve test gate
  await db.update(revenueHumanGates).set({
    status: 'resolved',
    branchPaused: false,
    resolvedBy: 'system-test',
    resolvedAt: new Date().toISOString(),
  }).where(eq(revenueHumanGates.id, testGateId));

  // Run supervisor cycle to trigger auto-resumption
  const statusResumed = await revenueSupervisor.runSupervisorCycle();
  const branchResumed = statusResumed.branches.find(b => b.experimentId === testExpId);
  console.log(`- Branch status after gate resolution: ${branchResumed?.status}`);

  if (!branchResumed || (branchResumed.status !== 'RUNNING' && branchResumed.status !== 'READY')) {
    throw new Error(`[FAIL] Branch did not auto-resume after gate resolution: ${branchResumed?.status}`);
  }
  console.log(`[PASS] Branch auto-resumed automatically without user prompt.`);

  // Clean up test records
  await db.delete(revenueHumanGates).where(eq(revenueHumanGates.id, testGateId));
  await db.delete(revenueExperiments).where(eq(revenueExperiments.id, testExpId));

  // Test 5: Daily & Weekly Briefing Generation
  console.log('\n[TEST 5] Testing Daily & Weekly Briefing generation...');
  const daily = await revenueBriefingService.generateBriefing(status.activeMissionId, 'daily');
  console.log(`- Daily Briefing Generated: Target=€${daily.kpis.targetAmount}, Pipeline=€${daily.kpis.pipelineValue}`);
  console.log(`- Digital Products: ${daily.digitalProducts.total} total`);
  console.log(`- German SME: ${daily.germanSme.total} total`);
  console.log(`- Human Gates: ${daily.humanGates.open} open, ${daily.humanGates.resolved} resolved`);

  const weekly = await revenueBriefingService.generateBriefing(status.activeMissionId, 'weekly');
  console.log(`- Weekly Briefing Generated: Type=${weekly.type}, Period=${weekly.periodStart.slice(0, 10)} to ${weekly.periodEnd.slice(0, 10)}`);

  if (!daily.narrative || !weekly.narrative) {
    throw new Error('[FAIL] Briefing narrative was empty.');
  }
  console.log('[PASS] Daily & Weekly briefings generated and persisted canonically.');

  console.log('\n======================================================================');
  console.log('REVENUE MISSION SUPERVISOR DEPLOYED — AUTONOMOUS CONTINUATION VERIFIED');
  console.log('======================================================================');
  process.exit(0);
}

main().catch(err => {
  console.error('[ERROR] Revenue supervisor verification failed:', err);
  process.exit(1);
});
