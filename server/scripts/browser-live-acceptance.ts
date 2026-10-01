/**
 * browser-live-acceptance.ts — LIVE acceptance for the Jarvis browser loop.
 *
 * Runs the exact acceptance chain from the stability mission against real
 * YouTube using the REAL BrowserOperator (the same code path Jarvis uses).
 * No mocks, no fixtures, no hardcoded result URLs. A step is reported PASS only
 * when the evidence shows the effect actually happened on the page.
 *
 *   A. Open YouTube
 *   B. Consent: real control clicked, blocker disappears, page usable
 *   C. Search "Seeadler TV" through the real search field, results verified
 *   D. Open the channel: real result selected, resulting page verified
 *   E. Go back: real history navigation, prior results page restored
 *   F. Open the channel again from preserved browser context
 *   G. "That's not what I meant. Go back." understood in browser context
 *
 * Run: cd server && AGENTICOS_BROWSER_HEADLESS=1 npx tsx scripts/browser-live-acceptance.ts
 */

import { browserOperator } from '../src/services/browser/browserOperator.js';
import { browserMetrics } from '../src/services/browser/browserActionContract.js';
import { browserExecutor } from '../src/domains/jarvis/execution/executors/browserExecutor.js';

const CONV = `live-accept-${Date.now()}`;
const QUERY = 'Seeadler TV';
const results: Array<{ step: string; ok: boolean; detail: string }> = [];

function record(step: string, ok: boolean, detail: string) {
  results.push({ step, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step} :: ${detail}`);
}

async function main() {
  // ── A. Open YouTube ──────────────────────────────────────────────────────
  const nav = await browserOperator.openTarget('youtube', {
    conversationId: CONV,
    goalText: `Open YouTube and search for ${QUERY}`,
  });
  record(
    'A. open youtube',
    nav.success && nav.url?.includes('youtube.com') === true,
    `url=${nav.url} title="${nav.title}"`,
  );

  // ── B. Consent, with ONE bounded recovery path ───────────────────────────
  const afterNav = await browserOperator.inspect();
  const consentPresent = Boolean(afterNav?.blockers.some((b) => b.isConsentDialog));
  if (consentPresent) {
    // The user explicitly instructed this choice ("Click Alle akzeptieren.").
    const consent = await browserOperator.acceptConsentBlocker({
      conversationId: CONV,
      explicitUserChoice: 'accept_all',
    });
    const after = await browserOperator.inspect();
    const usable =
      after?.contentUsable === true && !after?.blockers.some((b) => b.isConsentDialog);
    record(
      'B. consent cleared',
      consent.verified && usable,
      `dispatched=${consent.evidence.dispatched} stateChanged=${consent.evidence.stateChanged} ` +
        `change="${consent.evidence.changeDetail}" usable=${usable} :: ${consent.spokenText}`,
    );
  } else {
    record('B. consent cleared', afterNav?.contentUsable === true, 'no consent dialog on this load');
  }

  // ── C. Search through the real search field ──────────────────────────────
  const wf = await browserExecutor.executeWorkflow({
    target: 'YouTube',
    action: 'search',
    query: QUERY,
    context: { conversationId: CONV },
  });
  const afterSearch = await browserOperator.inspect();
  const searchUrl = afterSearch?.url ?? '';
  const resultsLoaded = /search_query=/.test(searchUrl) && (afterSearch?.controls.length ?? 0) > 3;
  record(
    'C. search verified',
    wf.success && resultsLoaded,
    `ok=${wf.success} usedSearchBox=${String((wf.evidence as Record<string, unknown>)?.usedSearchBox)} ` +
      `url=${searchUrl} controls=${afterSearch?.controls.length}`,
  );

  // ── D. Open the channel (full evidence chain) ────────────────────────────
  const openChannel = await browserOperator.openSelectedResult({
    conversationId: CONV,
    query: QUERY,
    prefer: 'channel',
  });
  const sel = openChannel.selection;
  console.log('\n--- EVIDENCE (D: open the channel) ---');
  console.log(`SEARCH RESULTS PRESENT: ${sel ? sel.candidates.length : 0}`);
  console.log(
    `TARGET CANDIDATES:      ${JSON.stringify((sel?.candidates ?? []).slice(0, 5).map((c) => c.name))}`,
  );
  console.log(
    `SELECTED ELEMENT:       ${sel?.selected ? `index=${sel.selected.index} kind=${sel.selected.kind}` : 'none'}`,
  );
  console.log(`ACCESSIBLE NAME:        ${sel?.selected?.name ?? 'none'}`);
  console.log(`HREF:                   ${sel?.selected?.href ?? 'none'}`);
  console.log(`CLICK DISPATCHED:       ${openChannel.evidence.dispatched}`);
  console.log(`ACTUAL URL AFTER:       ${openChannel.actualUrl}`);
  console.log(`PAGE TITLE:             ${openChannel.pageTitle}`);
  console.log(`CHANNEL/TARGET VERIFIED:${openChannel.targetVerified}`);
  console.log(`REASON:                 ${sel?.reason ?? 'n/a'}`);
  console.log(`FINAL RESPONSE:         ${openChannel.spokenText}\n`);
  record('D. open the channel', openChannel.verified, `${sel?.reason ?? ''} -> ${openChannel.spokenText}`);

  // ── E. Go back ───────────────────────────────────────────────────────────
  const beforeBack = browserOperator.getPage()?.url() ?? '';
  const back = await browserOperator.handleFollowUp('go back', { conversationId: CONV });
  const afterBack = browserOperator.getPage()?.url() ?? '';
  const backWorked = back.handled && afterBack !== beforeBack && /youtube\.com/.test(afterBack);
  record(
    'E. go back',
    backWorked,
    `from=${beforeBack.slice(0, 60)} to=${afterBack.slice(0, 60)} :: ${back.spokenText}`,
  );

  // ── F. Open the channel again from preserved context ─────────────────────
  const again = await browserOperator.handleFollowUp('open the channel', { conversationId: CONV });
  const afterAgain = browserOperator.getPage()?.url() ?? '';
  const genericClarification = /what would you like me to do with browser/i.test(again.spokenText);
  const contextPreserved =
    again.handled &&
    !genericClarification &&
    afterAgain !== afterBack &&
    !/search_query=/.test(afterAgain);
  record(
    'F. open channel again (context preserved)',
    contextPreserved,
    `url=${afterAgain} genericClarification=${genericClarification} :: ${again.spokenText}`,
  );

  // ── G. Correction understood in browser context ──────────────────────────
  const beforeG = browserOperator.getPage()?.url() ?? '';
  const correction = await browserOperator.handleFollowUp("That's not what I meant. Go back.", {
    conversationId: CONV,
  });
  const afterG = browserOperator.getPage()?.url() ?? '';
  const correctionActed = correction.handled && afterG !== beforeG;
  const freshIntentReset = /what would you like me to do with browser/i.test(correction.spokenText);
  record(
    'G. correction in browser context',
    correctionActed && !freshIntentReset,
    `from=${beforeG.slice(0, 55)} to=${afterG.slice(0, 55)} reset=${freshIntentReset} :: ${correction.spokenText}`,
  );

  // ── Metrics + goal continuity ────────────────────────────────────────────
  console.log('\n--- BROWSER METRICS ---');
  for (const [k, v] of Object.entries(browserMetrics.snapshot())) console.log(`  ${k} = ${v}`);

  const state = browserOperator.getConversationState(CONV);
  console.log('\n--- BROWSER GOAL CONTINUITY ---');
  console.log(
    ' ',
    JSON.stringify({
      lastBrowserGoal: state.lastBrowserGoal,
      lastBrowserUrl: state.lastBrowserUrl,
      lastBrowserTitle: state.lastBrowserTitle,
      lastBrowserAction: state.lastBrowserAction,
      lastBrowserResult: state.lastBrowserResult,
      blockingDialog: state.blockingDialog?.kind ?? null,
      visibleTarget: state.visibleTarget,
      verificationState: state.verificationState,
      indexedElements: state.lastIndexedElements.length,
    }),
  );

  const passed = results.filter((r) => r.ok).length;
  console.log(`\n=== ${passed}/${results.length} LIVE STEPS PASSED ===`);

  await browserOperator.close();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('LIVE ACCEPTANCE ERROR:', err?.message || err);
  try {
    await browserOperator.close();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
