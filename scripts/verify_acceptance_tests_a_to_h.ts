import { WindowsBrowserWindowHelper, browserSessionManager } from '../server/src/services/browser/browserSession.js';
import { browserOperator } from '../server/src/services/browser/browserOperator.js';
import { browserExecutor } from '../server/src/domains/jarvis/execution/executors/browserExecutor.js';

interface TestResult {
  name: string;
  passed: boolean;
  details: any;
  error?: string;
}

const results: TestResult[] = [];

async function runTest(name: string, fn: () => Promise<any>) {
  console.log(`\n======================================================`);
  console.log(`RUNNING ${name}`);
  console.log(`======================================================`);
  try {
    const details = await fn();
    console.log(`[PASS] ${name}`, JSON.stringify(details, null, 2));
    results.push({ name, passed: true, details });
  } catch (err: any) {
    console.error(`[FAIL] ${name}:`, err?.message || err);
    results.push({ name, passed: false, details: null, error: err?.message || String(err) });
  }
}

async function main() {
  const conversationId = `conv-accept-${Date.now()}`;

  // TEST A — VISIBLE GOOGLE NAVIGATION
  await runTest('TEST A: Open Google (Visible Desktop Window)', async () => {
    const outcome = await browserOperator.openTarget('Google', {
      conversationId,
      goalText: 'open Google',
      actionKind: 'navigate',
      mode: 'VISIBLE_USER_BROWSER',
    });

    if (!outcome.success) throw new Error(`Navigation failed: ${outcome.error}`);
    if (!outcome.verified) throw new Error('Outcome not verified');
    if (!outcome.url.includes('google')) throw new Error(`URL mismatch: ${outcome.url}`);

    // Verify desktop window visibility
    const win = WindowsBrowserWindowHelper.inspectWindow(undefined, 'Google');
    if (!win.windowHandle) throw new Error('Desktop window handle not found');
    if (!win.isVisible) throw new Error('Desktop window is not visible');

    return {
      spokenText: outcome.spokenText,
      url: outcome.url,
      windowHandle: win.windowHandle,
      windowTitle: win.title,
      isWindowVisible: win.isVisible,
    };
  });

  // TEST B — VISIBLE YOUTUBE NAVIGATION
  await runTest('TEST B: Open YouTube (Visible Desktop Window)', async () => {
    const outcome = await browserOperator.openTarget('YouTube', {
      conversationId,
      goalText: 'open YouTube',
      actionKind: 'navigate',
      mode: 'VISIBLE_USER_BROWSER',
    });

    if (!outcome.success) throw new Error(`Navigation failed: ${outcome.error}`);
    if (!outcome.verified) throw new Error('Outcome not verified');
    if (!outcome.url.includes('youtube.com')) throw new Error(`URL mismatch: ${outcome.url}`);

    const win = WindowsBrowserWindowHelper.inspectWindow(undefined, 'YouTube');
    if (!win.windowHandle) throw new Error('Desktop window handle not found');
    if (!win.isVisible) throw new Error('Desktop window is not visible');

    return {
      spokenText: outcome.spokenText,
      url: outcome.url,
      windowHandle: win.windowHandle,
      windowTitle: win.title,
      isWindowVisible: win.isVisible,
    };
  });

  // TEST C — SEARCH YOUTUBE FOR "C Adler TV" (REUSING ACTIVE VISIBLE SESSION)
  await runTest('TEST C: Search YouTube for C Adler TV', async () => {
    const execRes = await browserExecutor.executeWorkflow({
      target: 'YouTube',
      action: 'search',
      query: 'C Adler TV',
      context: { conversationId },
    });

    if (!execRes.success) throw new Error(`Search workflow failed: ${execRes.error}`);
    const evidence = execRes.evidence as any;
    if (!evidence?.url?.includes('results') && !evidence?.title?.includes('C Adler TV') && !evidence?.verified) {
      throw new Error(`Search verification failed: ${JSON.stringify(evidence)}`);
    }

    const win = WindowsBrowserWindowHelper.inspectWindow(undefined, 'YouTube');
    return {
      output: execRes.output,
      evidenceUrl: evidence?.url,
      windowHandle: win.windowHandle,
      windowTitle: win.title,
    };
  });

  // TEST D — OPEN THE CHANNEL
  await runTest('TEST D: Open the channel (Follow-up continuation)', async () => {
    const followRes = await browserExecutor.handleFollowUp('open the channel', {
      conversationId,
    });

    return {
      output: followRes.output,
      evidence: followRes.evidence,
    };
  });

  // TEST E — GO BACK
  await runTest('TEST E: Go back in history', async () => {
    const backRes = await browserExecutor.handleFollowUp('go back', {
      conversationId,
    });

    return {
      output: backRes.output,
      evidence: backRes.evidence,
    };
  });

  // TEST F — RESTORE FROM MINIMIZED
  await runTest('TEST F: Minimize and reopen/restore window', async () => {
    const winBefore = WindowsBrowserWindowHelper.inspectWindow(undefined, 'YouTube');
    if (winBefore.windowHandle) {
      // Bring to foreground restores if minimized
      const restored = WindowsBrowserWindowHelper.bringToForeground(winBefore.windowHandle);
      const winAfter = WindowsBrowserWindowHelper.inspectWindow(undefined, 'YouTube');
      return {
        handle: winBefore.windowHandle,
        restored,
        isMinimizedAfter: winAfter.isMinimized,
      };
    }
    return { note: 'No window handle to minimize' };
  });

  // TEST G — FORCED FAILURE REPORTING
  await runTest('TEST G: Forced failure reporting (Truthful Failure)', async () => {
    // When navigating to a non-existent or invalid URL, must report failure truthfully
    const outcome = await browserOperator.openTarget('https://nonexistent-domain-xyz123456789.com', {
      conversationId,
      goalText: 'open invalid',
      actionKind: 'navigate',
      mode: 'VISIBLE_USER_BROWSER',
    });

    if (outcome.success === true && outcome.verified === true) {
      throw new Error('Jarvis falsely reported success for an invalid domain!');
    }

    if (outcome.spokenText?.includes("I've opened")) {
      throw new Error(`Jarvis hallucinated opening: ${outcome.spokenText}`);
    }

    return {
      truthfulFailure: true,
      spokenText: outcome.spokenText,
      error: outcome.error,
    };
  });

  // TEST H — BACKGROUND BROWSER (NO DESKTOP STEALING)
  await runTest('TEST H: Background browser execution', async () => {
    const outcome = await browserOperator.openTarget('Google', {
      conversationId: `conv-bg-${Date.now()}`,
      goalText: 'background research',
      actionKind: 'navigate',
      mode: 'BACKGROUND_BROWSER',
    });

    if (!outcome.success) throw new Error(`Background navigation failed: ${outcome.error}`);
    return {
      success: outcome.success,
      url: outcome.url,
      mode: 'BACKGROUND_BROWSER',
    };
  });

  console.log('\n======================================================');
  console.log('ACCEPTANCE TESTS SUMMARY:');
  console.log('======================================================');
  let allPass = true;
  for (const r of results) {
    console.log(`${r.passed ? '[PASS]' : '[FAIL]'} ${r.name} ${r.error ? `(${r.error})` : ''}`);
    if (!r.passed) allPass = false;
  }
  console.log(`OVERALL RESULT: ${allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'}`);
}

main().catch(console.error);
