// Run the canonical ARGUS independent verification for the Phase 2C contract.
// SAFE MODE for the packaged/Roaming environment:
//   - verification record persists to the Roaming canonical DB;
//   - automatic correction dispatch is DISABLED (failure persists honestly,
//     no Codex correction loop is launched, no production mutation);
//   - each verifier subprocess runs against an isolated throwaway DB copy.
process.env.AGENTICOS_DATA_DIR = 'C:/Users/Cris/AppData/Roaming/agenticos/data';
process.env.AGENTICOS_ELECTRON_REMOTE_DEBUGGING_PORT = '9223';
process.env.ARGUS_DISABLE_CORRECTION = '1';

async function main() {
  console.log('=== PHASE 2C ARGUS VERIFICATION (verifyContract, SAFE/Roaming) ===\n');
  const { verifyContract, _setCorrectionLauncher } = await import('../server/dist/services/argus/argusService.js');
  const contractId = 'argus-revenue-phase2c-';

  // Disable automatic correction dispatch: on failure, persist the defect +
  // verification_failed honestly, but never launch a Codex correction loop.
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

main().catch(err => { console.error('ARGUS verification error:', err); process.exit(1); });
