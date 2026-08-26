// run-phase2d-argus-verify.cjs — run the canonical ARGUS verification for the
// Phase 2D contract against the Roaming canonical DB.
// SAFE MODE: automatic correction dispatch DISABLED; supervisor not activated;
// real gates untouched. Deterministic checks only (real-execution evidence is
// read from the persisted acceptance trace).
process.env.AGENTICOS_DATA_DIR = 'C:/Users/Cris/AppData/Roaming/agenticos/data';
process.env.ARGUS_DISABLE_CORRECTION = '1';

async function main() {
  console.log('=== PHASE 2D ARGUS VERIFICATION (verifyContract, SAFE/Roaming) ===\n');
  const { verifyContract, _setCorrectionLauncher } = await import('../server/dist/services/argus/argusService.js');
  const contractId = 'argus-revenue-phase2d-';

  _setCorrectionLauncher(async () => {
    console.log('[ARGUS] automatic correction dispatch DISABLED (safe verification mode).');
  });

  console.log(`- Verifying contract: ${contractId} (Roaming DB, correction disabled)\n`);
  const result = await verifyContract(contractId);

  console.log('\n=== ARGUS VERIFICATION RESULT ===');
  console.log(`- Verification ID: ${result.verificationId}`);
  console.log(`- Status: ${result.status}`);
  console.log(`- Evidence Level: ${result.evidenceLevel}`);
  console.log(`- Verdict: ${result.verdict.passed ? 'PASS' : 'FAIL'} — ${result.verdict.summary}`);
  console.log('\nChecks:');
  for (const c of result.verdict.checks) {
    console.log(`- [${c.passed ? 'PASS' : 'FAIL'}] ${c.name} (${c.level}) — ${c.evidence.slice(0, 160)}`);
  }
  if (result.verdict.blockingIssues.length) {
    console.log('\nBlocking issues:');
    for (const b of result.verdict.blockingIssues) console.log(`- ${b}`);
  }

  if (result.status !== 'verified_complete') {
    console.error('\nARGUS VERIFICATION FAILED');
    process.exit(1);
  }
  console.log(`\nARGUS VERIFICATION COMPLETE: ${result.verificationId} @ ${result.evidenceLevel}`);
  process.exit(0);
}

main().catch((err) => { console.error('ARGUS verification error:', err); process.exit(1); });
