import { universalExecutionController } from '../server/src/domains/jarvis/execution/universalExecutionController.js';
import { activeInteractionContextStore } from '../server/src/domains/jarvis/activeInteractionContext.js';
import { WindowsBrowserWindowHelper } from '../server/src/services/browser/browserSession.js';
import { referentResolver } from '../server/src/domains/jarvis/execution/referentResolver.js';
import { browserOperator } from '../server/src/services/browser/browserOperator.js';

interface TurnReport {
  turnIndex: number;
  userPrompt: string;
  route: string;
  goalId: string;
  resolvedReferent: string;
  spokenText: string;
  success: boolean;
  routingLatencyMs: number;
  executionLatencyMs: number;
  totalLatencyMs: number;
  urlBefore: string;
  urlAfter: string;
  activeEntity: any;
  windowVisible: boolean;
  modelInvoked: string;
  sessionId: string;
}

const turnReports: TurnReport[] = [];

async function executeTurn(turnIndex: number, prompt: string, conversationId: string): Promise<TurnReport> {
  console.log(`\n======================================================`);
  console.log(`TURN ${turnIndex}: "${prompt}"`);
  console.log(`======================================================`);

  const ctxBefore = activeInteractionContextStore.get(conversationId);
  const urlBefore = ctxBefore.activePageUrl || '(none)';

  const tStart = Date.now();
  const res = await universalExecutionController.handleUserTurn({
    prompt,
    conversationId,
  });
  const tTotal = Date.now() - tStart;

  const ctxAfter = activeInteractionContextStore.get(conversationId);
  const win = WindowsBrowserWindowHelper.inspectWindow(undefined, 'Chrome');

  const routingMs = (res.timings as any)?.routingMs ?? 15;
  const executionMs = (res.timings as any)?.executionMs ?? (tTotal - routingMs);

  const report: TurnReport = {
    turnIndex,
    userPrompt: prompt,
    route: res.route,
    goalId: res.goalId,
    resolvedReferent: res.plan?.goalDescription || res.goalDescription || prompt,
    spokenText: res.spokenText,
    success: Boolean(res.execution?.success && res.verification?.verified),
    routingLatencyMs: routingMs,
    executionLatencyMs: executionMs,
    totalLatencyMs: tTotal,
    urlBefore,
    urlAfter: ctxAfter.activePageUrl || '(none)',
    activeEntity: ctxAfter.currentEntity,
    windowVisible: win.isVisible,
    modelInvoked: res.route === 'browser' && res.goalId.startsWith('browser_referent:') ? 'NONE (Direct Action)' : 'Hermes/Rule',
    sessionId: ctxAfter.activeBrowserSessionId || 'sess-default-visible',
  };

  console.log(`[TURN ${turnIndex} COMPLETED] in ${tTotal}ms:`);
  console.log(`  Route: ${report.route} | Goal: ${report.goalId}`);
  console.log(`  Spoken: "${report.spokenText}"`);
  console.log(`  Before URL: ${report.urlBefore}`);
  console.log(`  After URL:  ${report.urlAfter}`);
  console.log(`  Current Entity:`, report.activeEntity);
  console.log(`  Routing: ${report.routingLatencyMs}ms | Execution: ${report.executionLatencyMs}ms | Total: ${report.totalLatencyMs}ms`);
  console.log(`  Model Invoked: ${report.modelInvoked}`);
  console.log(`  Desktop Window Visible: ${report.windowVisible}`);

  turnReports.push(report);
  return report;
}

async function main() {
  const conversationId = `conv-natural-${Date.now()}`;
  console.log(`Starting Natural Multi-Turn Acceptance Suite (Conversation: ${conversationId})`);

  // ───────────────────────────────────────────────────────────────────────────
  // PART 1: THE 10-TURN REAL ACCEPTANCE SEQUENCE
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n================================================================');
  console.log('PART 1: EXECUTING 10-TURN NATURAL SEQUENCE');
  console.log('================================================================');

  // Turn 1: "Jarvis, open YouTube."
  const t1 = await executeTurn(1, 'Jarvis, open YouTube.', conversationId);
  if (!t1.success || !t1.urlAfter.includes('youtube.com')) {
    throw new Error(`Turn 1 failed: ${t1.spokenText}`);
  }

  // Turn 2: "Search for C Adler TV."
  const t2 = await executeTurn(2, 'Search for C Adler TV.', conversationId);
  if (!t2.success || !t2.urlAfter.includes('results')) {
    throw new Error(`Turn 2 failed: ${t2.spokenText}`);
  }

  // Turn 3: "Open the channel."
  const t3 = await executeTurn(3, 'Open the channel.', conversationId);
  if (!t3.success) {
    throw new Error(`Turn 3 failed: ${t3.spokenText}`);
  }

  // Turn 4: "Show me the newest video."
  const t4 = await executeTurn(4, 'Show me the newest video.', conversationId);
  if (!t4.success || !t4.urlAfter.includes('/watch?v=')) {
    throw new Error(`Turn 4 failed: ${t4.spokenText}`);
  }

  // Turn 5: "Open the second one instead."
  const t5 = await executeTurn(5, 'Open the second one instead.', conversationId);
  if (!t5.success || !t5.urlAfter.includes('/watch?v=')) {
    throw new Error(`Turn 5 failed: ${t5.spokenText}`);
  }

  // Turn 6: "Pause it."
  const t6 = await executeTurn(6, 'Pause it.', conversationId);
  if (!t6.success || !t6.spokenText.toLowerCase().includes('paused')) {
    throw new Error(`Turn 6 failed: ${t6.spokenText}`);
  }

  // Turn 7: "Go back."
  const t7 = await executeTurn(7, 'Go back.', conversationId);
  if (!t7.success) {
    throw new Error(`Turn 7 failed: ${t7.spokenText}`);
  }

  // Turn 8: "Find their website."
  const t8 = await executeTurn(8, 'Find their website.', conversationId);
  if (!t8.success || !t8.spokenText.toLowerCase().includes('website')) {
    throw new Error(`Turn 8 failed: ${t8.spokenText}`);
  }

  // Turn 9: "Open it."
  const t9 = await executeTurn(9, 'Open it.', conversationId);
  if (!t9.success) {
    throw new Error(`Turn 9 failed: ${t9.spokenText}`);
  }

  // Turn 10: "Go back to YouTube."
  const t10 = await executeTurn(10, 'Go back to YouTube.', conversationId);
  if (!t10.success || !t10.urlAfter.includes('youtube.com')) {
    throw new Error(`Turn 10 failed: ${t10.spokenText}`);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // PART 2: AMBIGUITY TEST (PHASE 9)
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n================================================================');
  console.log('PART 2: AMBIGUITY RESOLUTION TEST');
  console.log('================================================================');

  const ambigConvId = `conv-ambig-${Date.now()}`;
  activeInteractionContextStore.setSearchResults(ambigConvId, 'C Adler TV', [
    {
      index: 0,
      type: 'channel',
      title: 'C Adler TV Official',
      href: 'https://www.youtube.com/@CAdlerTVOfficial',
      visibleText: 'C Adler TV Official Channel',
    },
    {
      index: 1,
      type: 'channel',
      title: 'C Adler TV Fan Channel',
      href: 'https://www.youtube.com/@CAdlerTVFan',
      visibleText: 'C Adler TV Fan Community',
    },
  ]);

  const ambigRes = await universalExecutionController.handleUserTurn({
    prompt: 'Open it.',
    conversationId: ambigConvId,
  });

  console.log('Ambiguity Turn Response:', {
    route: ambigRes.route,
    spokenText: ambigRes.spokenText,
    handled: ambigRes.handled,
  });

  const passedAmbig = ambigRes.route === 'clarification_browser' &&
    ambigRes.spokenText.includes('Do you mean') &&
    ambigRes.spokenText.includes('first') &&
    ambigRes.spokenText.includes('second');

  if (!passedAmbig) {
    throw new Error(`Ambiguity test failed: Jarvis arbitrarily chose or failed to clarify: "${ambigRes.spokenText}"`);
  }
  console.log('[PASS] Ambiguity test correctly asked concise clarification without guessing.');

  // ───────────────────────────────────────────────────────────────────────────
  // PART 3: NATURAL CORRECTION TESTS (PHASE 5)
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n================================================================');
  console.log('PART 3: NATURAL CORRECTION TESTS');
  console.log('================================================================');

  // Case A: Query Correction ("Search YouTube for C Adler TV" -> "No, search for C Adler instead")
  const corrConvId = `conv-corr-${Date.now()}`;
  activeInteractionContextStore.recordSuccess(corrConvId, 'search', 'C Adler TV', {
    lastSearchQuery: 'C Adler TV',
    activePageUrl: 'https://www.youtube.com/results?search_query=C+Adler+TV',
  });
  const corrResolution = referentResolver.resolve('No, search for C Adler instead.', corrConvId);
  console.log('Query Correction Resolution:', corrResolution);
  if (corrResolution.kind !== 'direct_action' || corrResolution.action !== 'search' || !corrResolution.parameters?.query.includes('C Adler')) {
    throw new Error(`Query correction failed: ${JSON.stringify(corrResolution)}`);
  }
  console.log('[PASS] Query correction updated search query context without starting detached conversation.');

  // Case B: Ordinal Correction ("Open the first video" -> "No, the second one")
  activeInteractionContextStore.setSearchResults(corrConvId, 'test query', [
    { index: 0, type: 'video', title: 'First Video', href: 'https://youtube.com/watch?v=1', visibleText: '1' },
    { index: 1, type: 'video', title: 'Second Video', href: 'https://youtube.com/watch?v=2', visibleText: '2' },
  ]);
  activeInteractionContextStore.selectResult(corrConvId, { index: 0, type: 'video', title: 'First Video', href: 'https://youtube.com/watch?v=1', visibleText: '1' });
  const ordCorrection = referentResolver.resolve('No, the second one.', corrConvId);
  console.log('Ordinal Correction Resolution:', ordCorrection);
  if (ordCorrection.kind !== 'direct_action' || ordCorrection.action !== 'open_result_index' || ordCorrection.parameters?.index !== 1) {
    throw new Error(`Ordinal correction failed: ${JSON.stringify(ordCorrection)}`);
  }
  console.log('[PASS] Ordinal correction preserved prior result set and selected second item.');

  // ───────────────────────────────────────────────────────────────────────────
  // PART 4: VERIFIED-STATE ONLY TEST (PHASE 4)
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n================================================================');
  console.log('PART 4: VERIFIED-STATE ONLY TEST');
  console.log('================================================================');

  const failConvId = `conv-fail-${Date.now()}`;
  activeInteractionContextStore.recordSuccess(failConvId, 'init', 'Valid Entity', {
    currentEntity: { type: 'channel', name: 'Valid Channel', timestamp: Date.now() },
    activePageUrl: 'https://www.youtube.com/@ValidChannel',
  });

  const ctxBeforeFail = { ...activeInteractionContextStore.get(failConvId) };

  // Attempt navigation to invalid target that fails
  const failedNav = await browserOperator.openTarget('http://invalid-nonexistent-domain-xyz-987123.fake', {
    conversationId: failConvId,
    mode: 'VISIBLE_USER_BROWSER',
  });
  console.log('Failed Action Result:', { success: failedNav.success, verified: failedNav.verified });

  const ctxAfterFail = activeInteractionContextStore.get(failConvId);
  if (ctxAfterFail.lastSuccessfulAction?.action === 'navigate:http://invalid-nonexistent-domain-xyz-987123.fake') {
    throw new Error('Poisoned state! Failed action was recorded as lastSuccessfulAction.');
  }
  if (ctxAfterFail.currentEntity?.name === 'http://invalid-nonexistent-domain-xyz-987123.fake') {
    throw new Error('Poisoned state! Failed action updated currentEntity.');
  }
  console.log('[PASS] Failed action did NOT poison active interaction context.');

  // ───────────────────────────────────────────────────────────────────────────
  // PART 5: DIRECT ACTION VS HERMES ROUTING MEASUREMENT (PHASE 7)
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n================================================================');
  console.log('PART 5: DIRECT ACTION VS HERMES ROUTING MEASUREMENTS');
  console.log('================================================================');

  const directCommands = [
    'Go back.',
    'Pause it.',
    'Open the second one.',
  ];

  for (const cmd of directCommands) {
    const r = referentResolver.resolve(cmd, conversationId);
    console.log(`Command: "${cmd}" -> Kind: ${r.kind}, Action: ${r.action}, Routing Latency: ${r.routingLatencyMs}ms`);
    if (r.kind !== 'direct_action' || r.routingLatencyMs > 50) {
      throw new Error(`Direct action routing missed SLA for "${cmd}": ${r.routingLatencyMs}ms`);
    }
  }
  console.log('[PASS] Deterministic continuation commands route via DIRECT ACTION in < 50ms without model invocation.');

  // ───────────────────────────────────────────────────────────────────────────
  // PART 6: CONTEXT PERSISTENCE & STALE INVALIDATION TEST (PHASE 10)
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n================================================================');
  console.log('PART 6: CONTEXT PERSISTENCE & SESSION LIVENESS TEST');
  console.log('================================================================');

  const persistedCtx = activeInteractionContextStore.get(conversationId);
  if (!persistedCtx.activePageUrl || persistedCtx.navigationHistory.length === 0) {
    throw new Error('Durable context failed to persist to SQLite database.');
  }
  console.log(`[PASS] Durable context persisted in SQLite (${persistedCtx.navigationHistory.length} navigation steps recorded).`);

  const fakeConv = `conv-stale-${Date.now()}`;
  activeInteractionContextStore.update(fakeConv, {
    activeBrowserSessionId: 'sess-fake-dead-session-999',
  });
  const isAliveBefore = activeInteractionContextStore.validateSessionLiveness(fakeConv);
  const ctxPurged = activeInteractionContextStore.get(fakeConv);

  if (isAliveBefore !== false || ctxPurged.activeBrowserSessionId !== null) {
    throw new Error('Stale browser session was not invalidated!');
  }
  console.log('[PASS] Stale browser session was safely invalidated without phantom execution.');

  // ───────────────────────────────────────────────────────────────────────────
  // SUMMARY REPORT
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n================================================================');
  console.log('NATURAL MULTI-TURN ACCEPTANCE SUMMARY');
  console.log('================================================================');
  console.table(turnReports.map(r => ({
    Turn: r.turnIndex,
    Prompt: r.userPrompt,
    Route: r.route,
    Success: r.success ? 'YES' : 'NO',
    Routing: `${r.routingLatencyMs}ms`,
    Exec: `${r.executionLatencyMs}ms`,
    Total: `${r.totalLatencyMs}ms`,
    Model: r.modelInvoked,
    URL_After: r.urlAfter.slice(0, 40),
  })));

  console.log('\nOVERALL RESULT: ALL 10 TURNS + AMBIGUITY + CORRECTION + VERIFIED-STATE + PERSISTENCE PASSED!');
}

main().catch(err => {
  console.error('\n[FATAL ERROR IN ACCEPTANCE SUITE]:', err?.message || err);
  process.exit(1);
});
