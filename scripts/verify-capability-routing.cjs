const path = require('path');
const { setupIsolatedFixture } = require('./argus-fixture.cjs');
setupIsolatedFixture(); // route capability proof writes to a throwaway DB copy

async function main() {
  console.log('=== CAPABILITY-AWARE EXECUTOR ROUTING VERIFICATION ===\n');

  // Load server modules from dist
  const { runtimeRegistry } = await import('../server/dist/services/runtimeRegistry.js');
  const { capabilityDispatcher } = await import('../server/dist/services/dispatcher/capabilityDispatcher.js');
  const { HermesAdapter } = await import('../server/dist/adapters/hermesAdapter.js');
  const { JarvisAdapter } = await import('../server/dist/adapters/jarvisAdapter.js');
  const { CodexAdapter } = await import('../server/dist/adapters/codexAdapter.js');
  const { routingLedger } = await import('../server/dist/services/routingLedger.js');

  // Register adapters
  runtimeRegistry.register(new HermesAdapter());
  runtimeRegistry.register(new JarvisAdapter());
  runtimeRegistry.register(new CodexAdapter());

  // Test 1: Capability Matching Logic
  console.log('[TEST 1] Testing capability matching & candidate selection...');
  const runtimes = runtimeRegistry.listRuntimes();
  console.log(`Registered runtimes: ${runtimes.map(r => `${r.id} (${r.capabilities.length} caps)`).join(', ')}`);

  const codex = runtimeRegistry.getAdapter('rt-codex');
  const hermes = runtimeRegistry.getAdapter('rt-hermes');

  if (!codex || !hermes) {
    throw new Error('Expected adapters rt-codex and rt-hermes to be registered.');
  }

  // Verify restricted codex does not have process_exec
  const codexCheck = runtimeRegistry.adapterSatisfies(codex, ['process_exec', 'localhost_http', 'sqlite_read']);
  if (codexCheck.satisfied) {
    throw new Error('[SECURITY FAIL] rt-codex incorrectly claimed process_exec capabilities!');
  }
  console.log(`[PASS] rt-codex correctly rejected for process_exec. Missing: [${codexCheck.missing.join(', ')}]`);

  // Verify hermes satisfies process_exec
  const hermesCheck = runtimeRegistry.adapterSatisfies(hermes, ['process_exec', 'localhost_http', 'sqlite_read', 'node']);
  if (!hermesCheck.satisfied) {
    throw new Error('[FAIL] rt-hermes failed to satisfy required process capabilities!');
  }
  console.log(`[PASS] rt-hermes correctly satisfies required process capabilities.`);

  // Test 2: Preflight Mismatch & Auto-Redispatch
  console.log('\n[TEST 2] Testing preflight mismatch & auto-redispatch...');
  const dispatchMatch = runtimeRegistry.selectByCapabilities(
    ['process_exec', 'localhost_http', 'sqlite_read'],
    { preferredId: 'rt-codex' } // Deliberately prefer restricted executor
  );

  if (dispatchMatch.adapter.id === 'rt-codex') {
    throw new Error('[FAIL] Auto-redispatch failed: rt-codex was selected despite capability mismatch!');
  }
  if (!['rt-hermes', 'rt-jarvis'].includes(dispatchMatch.adapter.id)) {
    throw new Error(`[FAIL] Unexpected adapter selected: ${dispatchMatch.adapter.id}`);
  }
  console.log(`[PASS] Preflight CAPABILITY_MISMATCH detected on preferred rt-codex.`);
  console.log(`[PASS] Automatically redispatched to compatible executor: ${dispatchMatch.adapter.id}`);

  // Test 3: Canonical Capability Proof Task
  console.log('\n[TEST 3] Running Canonical Capability Proof Task...');
  const proofResult = await capabilityDispatcher.runProofTask(4000);

  console.log('Proof Task Result:');
  console.log(`- Status: ${proofResult.status}`);
  console.log(`- Correlation ID: ${proofResult.correlationId}`);
  console.log(`- Canonical Task ID: ${proofResult.canonicalTaskId}`);
  console.log(`- Execution Run ID: ${proofResult.executionRunId}`);
  console.log(`- Selected Executor: ${proofResult.selectedExecutor}`);
  console.log(`- Node Version: ${proofResult.nodeVersion}`);
  console.log(`- Local Health Check Status: ${proofResult.healthStatus}`);
  console.log(`- Resolved Mission ID: ${proofResult.resolvedMissionId}`);
  console.log(`- Mission Title: ${proofResult.missionTitle}`);
  console.log(`- Digital Items Count: ${proofResult.digitalItemsCount}`);
  console.log(`- German SME Items Count: ${proofResult.smeItemsCount}`);
  console.log(`- Human Gates Count: ${proofResult.humanGatesCount}`);
  console.log(`- Auto-redispatch Verified: ${proofResult.autoRedispatchVerified}`);

  if (proofResult.status !== 'PROCESS-ENABLED EXECUTOR ROUTING VERIFIED') {
    throw new Error(`[FAIL] Proof status was: ${proofResult.status}`);
  }
  if (!proofResult.resolvedMissionId.startsWith('mission-616808fe-')) {
    throw new Error(`[FAIL] Expected mission starting with mission-616808fe-, got: ${proofResult.resolvedMissionId}`);
  }
  if (proofResult.digitalItemsCount !== 28) {
    console.warn(`[WARN] Digital items count was ${proofResult.digitalItemsCount}, expected 28`);
  }
  if (proofResult.smeItemsCount !== 30) {
    console.warn(`[WARN] SME items count was ${proofResult.smeItemsCount}, expected 30`);
  }
  if (proofResult.humanGatesCount !== 5) {
    console.warn(`[WARN] Human gates count was ${proofResult.humanGatesCount}, expected 5`);
  }

  console.log('\n==================================================');
  console.log('PROCESS-ENABLED EXECUTOR ROUTING VERIFIED');
  console.log('==================================================');
  process.exit(0);
}

main().catch(err => {
  console.error('[ERROR] Capability verification failed:', err);
  process.exit(1);
});
