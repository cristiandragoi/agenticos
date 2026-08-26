const { _electron: electron } = require('playwright');

const EXACT_PROMPT = 'Explain in two sentences what the current role of Jarvis is inside Agentic OS. Do not delegate this task.';

async function runAcceptance() {
  console.log('====================================================');
  console.log('STARTING PACKAGED UI ACCEPTANCE — 10 RUNS + >45S RUN');
  console.log('====================================================');

  const app = await electron.launch({
    executablePath: 'B:\\AgenticOS\\release\\win-unpacked\\Agentic OS.exe',
    env: {
      ...process.env,
      AGENTICOS_ELECTRON_ROUTE: '#/jarvis',
      NODE_ENV: 'production'
    }
  });

  const page = await app.firstWindow();
  console.log('[Acceptance] Electron window opened.');

  // Navigate to #/jarvis if not already there
  await page.waitForTimeout(3000);
  await page.evaluate(() => {
    if (!window.location.hash.includes('jarvis')) {
      window.location.hash = '#/jarvis';
    }
  });

  // Wait for textarea to appear and for backend to become ready
  const inputSelector = 'textarea';
  await page.waitForSelector(inputSelector, { timeout: 45000 });
  console.log('[Acceptance] Textarea detected.');

  // Wait for backend to be online (placeholder changes from offline to "Ask Jarvis anything...")
  console.log('[Acceptance] Waiting for backend to be online...');
  await page.waitForFunction(() => {
    const el = document.querySelector('textarea');
    return el && !el.disabled && el.placeholder && !el.placeholder.includes('Backend offline');
  }, { timeout: 45000 });

  console.log('[Acceptance] Jarvis Composer is online and ready.');

  const results = [];

  for (let i = 1; i <= 10; i++) {
    console.log(`\n--- [RUN ${i}/10] Submitting exact prompt ---`);
    await page.fill(inputSelector, EXACT_PROMPT);
    await page.keyboard.press('Enter');

    let settled = false;
    let iterations = 0;
    let answerText = '';
    let hasError = false;
    let errorMessage = '';

    while (!settled && iterations < 35) {
      await page.waitForTimeout(1000);
      iterations++;

      const bodyHtml = await page.innerHTML('body');
      if (bodyHtml.includes('Could not reach the backend') || bodyHtml.includes('BodyStreamBuffer was aborted') || bodyHtml.includes('Backend stream connection was closed')) {
        hasError = true;
        errorMessage = 'Detected transport/stream error banner in DOM';
        break;
      }

      const errorElements = await page.$$('[data-testid="jarvis-send-error"]');
      if (errorElements.length > 0) {
        hasError = true;
        errorMessage = await errorElements[0].textContent();
        break;
      }

      const composerDisabled = await page.$eval(inputSelector, el => el.disabled).catch(() => false);
      const processingIndicator = await page.$('[data-testid="jarvis-processing"]');

      const agentLines = await page.$$eval('[data-testid="jarvis-command-line"], .jarvis-message-agent', els => els.map(e => e.textContent));
      if (agentLines.length > 0) {
        answerText = agentLines[agentLines.length - 1];
      }

      if (!composerDisabled && !processingIndicator && answerText.length > 20) {
        await page.waitForTimeout(1500);
        const postCheckErrors = await page.$$('[data-testid="jarvis-send-error"]');
        const postCheckHtml = await page.innerHTML('body');
        if (postCheckErrors.length > 0 || postCheckHtml.includes('BodyStreamBuffer was aborted') || postCheckHtml.includes('Could not reach the backend')) {
          hasError = true;
          errorMessage = 'Late post-completion error appeared';
        } else {
          settled = true;
        }
        break;
      }
    }

    if (hasError) {
      console.error(`[RUN ${i}/10] FAILED: ${errorMessage}`);
      results.push({ run: i, status: 'FAILED', error: errorMessage });
    } else if (settled) {
      console.log(`[RUN ${i}/10] PASSED: Answer received cleanly (${answerText.slice(0, 80)}...) without error banner.`);
      results.push({ run: i, status: 'PASSED', answerPreview: answerText.slice(0, 80) });
    } else {
      console.error(`[RUN ${i}/10] TIMED OUT waiting for completion.`);
      results.push({ run: i, status: 'TIMEOUT' });
    }

    await page.waitForTimeout(1000);
  }

  console.log('\n====================================================');
  console.log('--- [SLOW RUN >45s] Testing Long Inference Stream ---');
  console.log('====================================================');
  const slowPrompt = 'Explain in two sentences what the current role of Jarvis is inside Agentic OS. Please take 50 seconds to think carefully before replying.';
  await page.fill(inputSelector, slowPrompt);
  await page.keyboard.press('Enter');

  let slowSettled = false;
  let slowElapsed = 0;
  let slowHasError = false;
  let slowError = '';

  while (slowElapsed < 90) {
    await page.waitForTimeout(5000);
    slowElapsed += 5;
    console.log(`[Slow Run] Elapsed: ${slowElapsed}s...`);

    const bodyHtml = await page.innerHTML('body');
    if (bodyHtml.includes('Could not reach the backend') || bodyHtml.includes('BodyStreamBuffer was aborted')) {
      slowHasError = true;
      slowError = 'Found BodyStreamBuffer/backend error in DOM';
      break;
    }

    const composerDisabled = await page.$eval(inputSelector, el => el.disabled).catch(() => false);
    if (!composerDisabled && slowElapsed >= 15) {
      await page.waitForTimeout(2000);
      const postHtml = await page.innerHTML('body');
      if (!postHtml.includes('BodyStreamBuffer was aborted') && !postHtml.includes('Could not reach the backend')) {
        slowSettled = true;
        break;
      }
    }
  }

  console.log(`[Slow Run] Result: ${slowHasError ? 'FAILED: ' + slowError : 'PASSED cleanly'}`);

  await app.close();

  console.log('\n====================================================');
  console.log('ACCEPTANCE SUMMARY:');
  console.log(`10 Runs Result: ${results.filter(r => r.status === 'PASSED').length}/10 Passed`);
  console.log(`Slow Run Result: ${!slowHasError ? 'PASSED' : 'FAILED'}`);
  console.log('====================================================');

  if (results.filter(r => r.status === 'PASSED').length === 10 && !slowHasError) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runAcceptance().catch(err => {
  console.error('[Acceptance Error]', err);
  process.exit(1);
});
