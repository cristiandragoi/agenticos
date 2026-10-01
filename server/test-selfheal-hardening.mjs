// Verification of Item 5 & Item 6: Self-Heal Safety Policy and Loop Protection
import { selfHealSupervisor } from './dist/domains/selfHeal/SelfHealSupervisor.js';
import { isHumanApprovalRequired } from './dist/domains/selfHeal/SelfHealSupervisor.js';

async function run() {
  console.log('=== VERIFYING SELF-HEAL SAFETY POLICY & LOOP PROTECTION ===\n');
  await selfHealSupervisor.initialize();

  // Test 1: Auto-approvable classification vs Human-approval required
  console.log('--- Test 1: Operation Classification ---');
  const safeOps = [
    { verb: 'rename', entityType: 'project', prompt: 'Rename Free Cash to Cash Engine.' },
    { verb: 'rebuild', entityType: 'adapter', prompt: 'Rebuild local code adapter.' },
    { verb: 'register', entityType: 'capability', prompt: 'Fix broken local capability registration.' },
    { verb: 'restart', entityType: 'service', prompt: 'Restart local service.' },
  ];
  for (const op of safeOps) {
    const req = isHumanApprovalRequired(op);
    console.log(`  Safe Op [${op.verb} on ${op.entityType}]: requiresHuman = ${req} -> ${!req ? 'PASS (AUTO-APPROVABLE)' : 'FAIL'}`);
    if (req) throw new Error(`Expected ${op.verb} to be auto-approvable`);
  }

  const dangerousOps = [
    { verb: 'delete', entityType: 'project', prompt: 'Delete user project database.' },
    { verb: 'drop', entityType: 'database', prompt: 'Drop user data table.' },
    { verb: 'rotate', entityType: 'credentials', prompt: 'Rotate API credentials.' },
    { verb: 'spend', entityType: 'billing', prompt: 'Spend $500 on campaign.' },
    { verb: 'deploy', entityType: 'production', prompt: 'Deploy to external production.' },
  ];
  for (const op of dangerousOps) {
    const req = isHumanApprovalRequired(op);
    console.log(`  Dangerous Op [${op.verb} on ${op.entityType}]: requiresHuman = ${req} -> ${req ? 'PASS (HUMAN-APPROVAL REQUIRED)' : 'FAIL'}`);
    if (!req) throw new Error(`Expected ${op.verb} to require human approval`);
  }

  // Test 2: Fixture 1: Safe repair completes autonomously
  console.log('\n--- Test 2: Fixture 1: Safe repair completes autonomously ---');
  const safeIncidentId = `SELFHEAL-SAFE-${Date.now().toString(36)}`;
  const safeRes = await selfHealSupervisor.executeClosedLoopRepair({
    incidentId: safeIncidentId,
    originalAction: {
      prompt: 'Rename Free Cash to Cash Engine.',
      conversationId: 'conv-safe-test',
      entityId: 'proj-freecash-test',
      entityType: 'project',
      entityName: 'Free Cash',
      verb: 'rename',
    },
  });
  const safeState = selfHealSupervisor.getIncidentState(safeIncidentId);
  console.log(`  Safe repair result: success=${safeRes.success}, finalState=${safeState}`);
  if (!safeRes.success || safeState !== 'COMPLETED') {
    throw new Error(`Safe repair failed: state is ${safeState}`);
  }
  console.log('  Fixture 1 (Safe repair autonomous): PASS');

  // Test 3: Fixture 2: Dangerous repair stops at AWAITING_APPROVAL without fake approval
  console.log('\n--- Test 3: Fixture 2: Dangerous repair stops at AWAITING_APPROVAL ---');
  const dangerousIncidentId = `SELFHEAL-DANGEROUS-${Date.now().toString(36)}`;
  const dangerousRes = await selfHealSupervisor.executeClosedLoopRepair({
    incidentId: dangerousIncidentId,
    originalAction: {
      prompt: 'Delete all user credentials and purge external keys.',
      conversationId: 'conv-dangerous-test',
      entityId: 'cred-store',
      entityType: 'credentials',
      entityName: 'Production Credentials',
      verb: 'delete',
    },
  });
  const dangerousState = selfHealSupervisor.getIncidentState(dangerousIncidentId);
  console.log(`  Dangerous repair result: success=${dangerousRes.success}, error="${dangerousRes.error}", finalState=${dangerousState}`);
  if (dangerousRes.success !== false || dangerousState !== 'AWAITING_APPROVAL') {
    throw new Error(`Dangerous repair did not halt at AWAITING_APPROVAL: state is ${dangerousState}, success=${dangerousRes.success}`);
  }
  console.log('  Fixture 2 (Dangerous repair halted at AWAITING_APPROVAL without fake approval): PASS');

  // Test 4: Loop Protection: Exceeding MAX_SELFHEAL_REPAIR_ATTEMPTS (3) transitions to BLOCKED_MAX_ATTEMPTS_EXCEEDED
  console.log('\n--- Test 4: Loop Protection (Max 3 attempts) ---');
  const loopIncidentId = `SELFHEAL-LOOP-${Date.now().toString(36)}`;
  
  // Set component attempts to 3 directly so the next attempt will be the 4th (exceeding max 3)
  selfHealSupervisor['componentAttempts'].set(loopIncidentId, 3);
  const loopRes = await selfHealSupervisor.executeClosedLoopRepair({
    incidentId: loopIncidentId,
    originalAction: {
      prompt: 'Repair recurring defect.',
      conversationId: 'conv-loop-test',
      entityId: 'comp-loop',
      entityType: 'component',
      entityName: 'Looping Component',
      verb: 'rebuild',
    },
  });
  const loopState = selfHealSupervisor.getIncidentState(loopIncidentId);
  console.log(`  Loop test result: success=${loopRes.success}, finalState=${loopState}, error="${loopRes.error}"`);
  if (loopRes.success !== false || loopState !== 'BLOCKED_MAX_ATTEMPTS_EXCEEDED') {
    throw new Error(`Loop protection failed: expected BLOCKED_MAX_ATTEMPTS_EXCEEDED, got ${loopState}`);
  }
  console.log('  Loop Protection (halted at BLOCKED_MAX_ATTEMPTS_EXCEEDED): PASS');

  console.log('\n================ ALL SELF-HEAL SAFETY & LOOP TESTS PASSED ================');
}

run().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
