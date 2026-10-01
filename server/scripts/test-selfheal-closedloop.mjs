// Self-Heal Closed-Loop Automated Test Fixture
// Tests complete lifecycle:
// expected capability fails/missing
// → failure detector (SELFHEAL_DETECTED, SELFHEAL_INCIDENT_CREATED)
// → Self-Heal Engineering Supervisor (SELFHEAL_ENGINEERING_STARTED)
// → diagnose root cause
// → choose engineering worker
// → implement minimal repair (SELFHEAL_PATCH_APPLIED)
// → build (SELFHEAL_BUILD_PASS)
// → run targeted tests (SELFHEAL_TEST_PASS)
// → reload/register capability (SELFHEAL_CAPABILITY_RELOADED)
// → retry ORIGINAL USER ACTION (SELFHEAL_ORIGINAL_ACTION_RETRIED)
// → read state back
// → verify (SELFHEAL_RESULT_VERIFIED)

import { projectsStore } from '../dist/services/projectsStore.js';
import { routeTurn } from '../dist/domains/jarvisNext/turnRouter.js';
import { selfHealSupervisor } from '../dist/domains/selfHeal/SelfHealSupervisor.js';
import { db } from '../dist/db/index.js';
import { projects } from '../dist/db/schema.js';
import { repairIncidents } from '../dist/domains/selfHeal/schema.js';
import { eq } from 'drizzle-orm';

const FIXTURE_PROJECT_ID = 'proj-selfheal-test-isolated';
const ORIGINAL_NAME = 'Safe SelfHeal Test Project';
const REPAIRED_NAME = 'Safe SelfHeal Repaired Project';

async function run() {
  console.log('════════════════════════════════════════════════════════════');
  console.log('   SELF-HEAL CLOSED LOOP TEST');
  console.log('════════════════════════════════════════════════════════════\n');

  // 1. Setup isolated test project in DB
  try {
    db.delete(projects).where(eq(projects.id, FIXTURE_PROJECT_ID)).run();
  } catch {}

  projectsStore.createProject({
    id: FIXTURE_PROJECT_ID,
    name: ORIGINAL_NAME,
    description: 'Isolated test project for self-heal capability repair verification',
    status: 'active',
    priority: 88,
  });

  console.log(`[Setup] Created test project: ${ORIGINAL_NAME} (${FIXTURE_PROJECT_ID})`);

  // Capture logs
  const logs = [];
  const origLog = console.log;
  console.log = (...args) => {
    const line = args.join(' ');
    logs.push(line);
    origLog(...args);
  };

  try {
    // 2. Initial state: No rename capability is wired for projects.
    // User attempts: "Rename Safe SelfHeal Test Project to Safe SelfHeal Repaired Project"
    console.log(`\n[Step 1] Triggering turn with missing rename capability...`);
    const initialResult = await routeTurn({
      prompt: `Rename ${ORIGINAL_NAME} to ${REPAIRED_NAME}`,
      conversationId: 'test-conv-selfheal',
    });

    console.log('[Turn Result 1]', initialResult.text);

    // Give closed loop a moment to finish asynchronously if backgrounded
    for (let i = 0; i < 20; i++) {
      const p = projectsStore.getProject(FIXTURE_PROJECT_ID);
      if (p?.name === REPAIRED_NAME && logs.some(l => l.includes('SELFHEAL_RESULT_VERIFIED'))) break;
      await new Promise(r => setTimeout(r, 500));
    }

    // 3. Check for the 9 required tokens
    const requiredTokens = [
      'SELFHEAL_DETECTED',
      'SELFHEAL_INCIDENT_CREATED',
      'SELFHEAL_ENGINEERING_STARTED',
      'SELFHEAL_PATCH_APPLIED',
      'SELFHEAL_BUILD_PASS',
      'SELFHEAL_TEST_PASS',
      'SELFHEAL_CAPABILITY_RELOADED',
      'SELFHEAL_ORIGINAL_ACTION_RETRIED',
      'SELFHEAL_RESULT_VERIFIED',
    ];

    console.log('\n[Verification] Checking evidence log tokens:');
    let allTokensFound = true;
    for (const token of requiredTokens) {
      const found = logs.some(l => l.includes(token));
      console.log(`  - ${token}: ${found ? '✅ PASS' : '❌ FAIL'}`);
      if (!found) allTokensFound = false;
    }

    // 4. Read back state from authoritative database
    const readbackProject = projectsStore.getProject(FIXTURE_PROJECT_ID);
    console.log('\n[Authoritative Readback]', {
      id: readbackProject?.id,
      name: readbackProject?.name,
      expected: REPAIRED_NAME,
    });

    const stateVerified = readbackProject?.name === REPAIRED_NAME;
    console.log(`  - Project renamed in store: ${stateVerified ? '✅ PASS' : '❌ FAIL'}`);

    // 5. Read back incident state from authoritative database
    let incidentId = null;
    for (const l of logs) {
      if (l.includes('SELFHEAL_INCIDENT_CREATED')) {
        const m = l.match(/incidentId[:=]"?([a-zA-Z0-9_\-]+)"?/i) || l.match(/(SELFHEAL-\d+)/);
        if (m) {
          incidentId = m[1];
          break;
        }
      }
    }
    let incidentClosed = false;
    let incidentRow = null;
    if (incidentId) {
      const rows = db.select().from(repairIncidents).where(eq(repairIncidents.id, incidentId)).all();
      incidentRow = rows[0];
      incidentClosed = incidentRow && incidentRow.status === 'COMPLETED' && Boolean(incidentRow.resolvedAt);
    }
    console.log('\n[Incident Readback]', {
      incidentId,
      status: incidentRow?.status,
      resolvedAt: incidentRow?.resolvedAt,
    });
    console.log(`  - Incident automatically closed: ${incidentClosed ? '✅ PASS' : '❌ FAIL'}`);

    if (allTokensFound && stateVerified && incidentClosed) {
      console.log('\n🎉 ALL SELF-HEAL ACCEPTANCE CRITERIA PASSED!');
      process.exit(0);
    } else {
      console.error('\n❌ SELF-HEAL ACCEPTANCE FAILED!');
      process.exit(1);
    }
  } finally {
    console.log = origLog;
    // Clean up fixture project
    try {
      db.delete(projects).where(eq(projects.id, FIXTURE_PROJECT_ID)).run();
      console.log(`[Cleanup] Removed test fixture ${FIXTURE_PROJECT_ID}`);
    } catch {}
  }
}

run().catch(err => {
  console.error('Fatal error running self-heal closed-loop test:', err);
  process.exit(1);
});
