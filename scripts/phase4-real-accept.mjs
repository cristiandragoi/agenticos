/**
 * Phase 4 — REAL-adapter live acceptance (attended, controlled fixture).
 *
 * Runs the REAL production adapters (real Hermes plan via executeHermesTask,
 * real CodeX repair via codexService.createGoal, real test gates via
 * gates/registry + vitest, real verifier) against the REAL repo, scoped to the
 * single untracked maintenance fixture file. Stops at ready_for_approval.
 *
 * NEVER commits, never approves, never deploys.
 */
import {
  diagnoseAndRepair,
  getMaintenanceStatus,
  buildApprovalCheckpoint,
} from '../server/dist/services/maintenance/maintenanceSupervisor.js';

const REPO = 'B:/AgenticOS';
const FIXTURE = 'server/src/services/maintfixture/calc.ts';
const SUITE = 'maintfixture';
const CHANGE_SET_ID = 'phase4-real-accept';

console.log('[1] changeSetId:', CHANGE_SET_ID);
console.log('[2] owned files:', [FIXTURE]);
console.log('[3] focused suites:', [SUITE]);
console.log('[4] repo:', REPO);

const t0 = Date.now();
let outcome;
try {
  outcome = await diagnoseAndRepair({
    changeSetId: CHANGE_SET_ID,
    evidence:
      'The controlled maintenance fixture test `npx vitest run maintfixture` is failing: add(2,3) returns -1 but the test expects 5, because server/src/services/maintfixture/calc.ts implements subtraction (`return a - b`) instead of addition (`return a + b`).',
    originatingFindingId: 'finding-maintfixture',
    originatingResultId: 'exr-phase4-real-analysis',
    files: [FIXTURE],
    forbiddenFiles: ['server/src/domains/jarvis/', 'server/src/routers/', 'release/', 'server/data/'],
    suites: [SUITE],
    repoPath: REPO,
    conversationId: undefined,
  });
} catch (e) {
  console.error('\n[FATAL] diagnoseAndRepair threw:', e?.message || e);
  process.exit(2);
}
const elapsed = Math.round((Date.now() - t0) / 1000);

console.log('\n[5] repair loop outcome (elapsed %ds):', elapsed);
console.log('    status     =', outcome.status);
console.log('    attempts   =', outcome.attempts);
console.log('    reason     =', outcome.reason || '(none)');
for (const a of outcome.attemptsLog || []) {
  console.log(`    attempt ${a.attempt}: plan=${a.planResultId} repair=${a.repairResultId} files=${JSON.stringify(a.filesChanged)} decision=${a.decision}`);
}

const cs = outcome.changeSet;
console.log('\n[6] changeSet:', JSON.stringify({
  id: cs.id,
  status: cs.status,
  originatingFindingId: cs.originatingFindingId,
  originatingResultId: cs.originatingResultId,
  files: cs.files,
  filesChanged: cs.filesChanged,
  planResultId: cs.planResultId,
  repairResultId: cs.repairResultId,
  attempts: cs.attempts,
  reason: cs.reason,
}, null, 2));

console.log('\n[7] testResults:', JSON.stringify(cs.testResults, null, 2));
console.log('\n[8] verification:', JSON.stringify(cs.verification, null, 2));

const last = (outcome.attemptsLog || []).slice(-1)[0];
if (last && cs.status === 'ready_for_approval') {
  const cp = buildApprovalCheckpoint(CHANGE_SET_ID, last.testResults, outcome.attempts);
  console.log('\n[9] approval checkpoint:');
  console.log('    status         =', cp.status);
  console.log('    risk           =', cp.risk);
  console.log('    filesOwned     =', JSON.stringify(cp.filesOwned));
  console.log('    proposedCommit =', cp.proposedCommit);
  console.log('    unrelatedPreserved =', cp.unrelatedPreserved);
}

const pending = getMaintenanceStatus();
console.log('\n[10] where-were-we (reconstructed from persistence):', pending ? `${pending.status} / ${pending.id} / files=${JSON.stringify(pending.files)}` : 'none');

console.log('\nACCEPTANCE COMPLETE — stopped at READY_FOR_APPROVAL (no commit, no approval, no deploy).');
