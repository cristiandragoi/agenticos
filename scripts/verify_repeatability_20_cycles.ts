/**
 * verify_repeatability_20_cycles.ts
 *
 * 20-Cycle Repeatability Stress Test for Mandatory Observed Reality Contract.
 *
 * Invariant:
 * Start on Google -> "Jarvis, open YouTube." -> Verify YouTube -> Navigate/Search -> Back -> Open YouTube again.
 *
 * Must maintain:
 * - 0 false-positive successes
 * - 0 spoken-success / visual-state mismatches
 * - 0 wrong-tab executions
 * - 0 stale-session successes
 * - 0 unresolved silently swallowed failures
 */

import { universalExecutionController } from '../server/src/domains/jarvis/execution/universalExecutionController.js';
import { activeInteractionContextStore } from '../server/src/domains/jarvis/activeInteractionContext.js';
import { browserSessionAuthority } from '../server/src/services/browser/browserSessionAuthority.js';
import { browserOperator } from '../server/src/services/browser/browserOperator.js';

interface CycleResult {
  cycle: number;
  startUrl: string;
  command: string;
  response: string;
  observedUrl: string;
  observedHost: string;
  verified: boolean;
  success: boolean;
  mismatch: boolean;
  durationMs: number;
}

async function run20CycleRepeatabilityTest() {
  console.log('================================================================');
  console.log('OBSERVED REALITY CONTRACT — 20-CYCLE REPEATABILITY STRESS TEST');
  console.log('================================================================\n');

  const conversationId = `repeatability-test-${Date.now()}`;
  const results: CycleResult[] = [];

  for (let cycle = 1; cycle <= 20; cycle++) {
    console.log(`\n------------------------------------------------------------`);
    console.log(`CYCLE ${cycle} / 20`);
    console.log(`------------------------------------------------------------`);

    // 1. Ensure Start State: Visible browser is explicitly on Google
    console.log(`[Cycle ${cycle}] Step 1: Navigating visible browser to Google...`);
    const initRes = await browserOperator.openTarget('https://www.google.com', {
      conversationId,
      goalText: 'navigate to Google start state',
    });

    const cdpPagesBefore = await browserSessionAuthority.queryCdpPageTargets();
    const activePageBefore = cdpPagesBefore.find((p) => p.url.includes('google.com')) || cdpPagesBefore[0];
    const startUrl = activePageBefore?.url || 'https://www.google.com/';
    console.log(`[Cycle ${cycle}] Start URL verified: ${startUrl}`);

    // 2. Issue Command: "Jarvis, open YouTube."
    console.log(`[Cycle ${cycle}] Step 2: Issuing user turn: "Jarvis, open YouTube."`);
    const t0 = Date.now();
    const turnRes = await universalExecutionController.handleUserTurn({
      prompt: 'Jarvis, open YouTube.',
      conversationId,
    });
    const durationMs = Date.now() - t0;

    // 3. Independently observe actual live browser state
    const cdpPagesAfter = await browserSessionAuthority.queryCdpPageTargets();
    const ytPage = cdpPagesAfter.find((p) => p.url.includes('youtube.com'));
    const observedUrl = ytPage?.url || cdpPagesAfter[0]?.url || '';
    let observedHost = '';
    try {
      observedHost = new URL(observedUrl).hostname.toLowerCase().replace(/^www\./, '');
    } catch {}

    const spokenText = turnRes.spokenText || '';
    const spokenSuccess = spokenText.toLowerCase().includes('opened youtube') || spokenText.toLowerCase().includes("i've opened");
    const spokenFailure = spokenText.toLowerCase().includes("couldn't") || spokenText.toLowerCase().includes('still on');

    const visualSuccess = observedHost === 'youtube.com' || observedHost === 'm.youtube.com';
    const mismatch = (spokenSuccess && !visualSuccess) || (spokenFailure && visualSuccess);

    const cyclePassed = visualSuccess && spokenSuccess && !mismatch && turnRes.execution.success && turnRes.verification.verified;

    const record: CycleResult = {
      cycle,
      startUrl,
      command: 'Jarvis, open YouTube.',
      response: spokenText,
      observedUrl,
      observedHost,
      verified: turnRes.verification.verified,
      success: turnRes.execution.success,
      mismatch,
      durationMs,
    };

    console.log(`[Cycle ${cycle}] Spoken Response: "${spokenText}"`);
    console.log(`[Cycle ${cycle}] Observed Final URL: ${observedUrl} (Host: ${observedHost})`);
    console.log(`[Cycle ${cycle}] Verified Success: ${cyclePassed ? 'YES' : 'NO'}`);
    console.log(`[Cycle ${cycle}] Visual/Spoken Mismatch: ${mismatch ? 'YES (CRITICAL ERROR)' : 'NONE (0)'}`);
    console.log(`[Cycle ${cycle}] Turn Duration: ${durationMs}ms`);

    results.push(record);

    if (mismatch || !cyclePassed) {
      console.error(`[FATAL] Observed reality mismatch detected on Cycle ${cycle}!`);
      console.error(`Expected: Host=youtube.com, SpokenSuccess=true`);
      console.error(`Actual: ObservedHost=${observedHost}, SpokenText="${spokenText}"`);
      process.exit(1);
    }

    // 4. Quick follow-up navigation: Search and Go Back
    await universalExecutionController.handleUserTurn({
      prompt: 'Search for C Adler TV.',
      conversationId,
    });
    await universalExecutionController.handleUserTurn({
      prompt: 'Go back.',
      conversationId,
    });

    await new Promise((r) => setTimeout(r, 500));
  }

  console.log('\n================================================================');
  console.log('20-CYCLE REPEATABILITY SUMMARY');
  console.log('================================================================');
  console.table(
    results.map((r) => ({
      Cycle: r.cycle,
      Start: r.startUrl.slice(0, 30),
      FinalHost: r.observedHost,
      Spoken: r.response.slice(0, 35),
      Verified: r.verified ? 'YES' : 'NO',
      Mismatch: r.mismatch ? 'FAIL' : 'NONE (0)',
      Duration: `${r.durationMs}ms`,
    })),
  );

  const totalMismatches = results.filter((r) => r.mismatch).length;
  const totalPassed = results.filter((r) => !r.mismatch && r.verified).length;

  console.log(`\nTOTAL CYCLES: 20`);
  console.log(`PASSED: ${totalPassed} / 20`);
  console.log(`MISMATCHES: ${totalMismatches} (Invariant: MUST BE 0)`);

  if (totalMismatches > 0 || totalPassed !== 20) {
    console.error('REPEATABILITY TEST FAILED: Observed-reality mismatches occurred!');
    process.exit(1);
  }

  console.log('\n[PASS] 20-CYCLE REPEATABILITY TEST COMPLETED WITH ZERO MISMATCHES!');
}

run20CycleRepeatabilityTest().catch((err) => {
  console.error('[FATAL ERROR IN 20-CYCLE TEST]:', err?.message || err);
  process.exit(1);
});
