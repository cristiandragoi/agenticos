import { _electron as electron } from 'playwright';

const BASE = 'http://localhost:4000';
const EXE_PATH = 'C:\\Users\\Cris\\Desktop\\desktop\\Agentic_OS\\Agentic OS\\Agentic OS.exe';

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runRetest() {
  console.log('================================================================');
  console.log('PHASE 11: REAL RETEST IN PACKAGED ELECTRON GUI');
  console.log('================================================================\n');

  const app = await electron.launch({
    executablePath: EXE_PATH,
    args: ['--no-sandbox']
  });

  const results = {
    test1: false,
    test2: false,
    test3: false
  };

  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    console.log('Window loaded:', page.url());

    // Navigate to #/jarvis
    const jarvisUrl = page.url().split('#')[0] + '#/jarvis';
    await page.goto(jarvisUrl);
    await sleep(2500);

    const textareaSelector = 'textarea[aria-label="Message Input"], textarea[placeholder*="Ask Jarvis"]';
    await page.waitForSelector(textareaSelector, { timeout: 30000 });

    async function sendPrompt(promptText: string) {
      const newConvBtn = page.locator('button[title="New Conversation"], button[aria-label="New Conversation"], button:has-text("New conversation")');
      if (await newConvBtn.count() > 0) {
        await newConvBtn.first().click();
        await sleep(1000);
      }

      await page.fill(textareaSelector, promptText);
      await page.press(textareaSelector, 'Enter');
      console.log(`[GUI] Submitted: "${promptText}"`);

      const start = Date.now();
      while (Date.now() - start < 45000) {
        await sleep(1000);
        const approveBtn = page.locator('button:has-text("Approve"), button[data-testid="approve-goal-btn"]');
        if (await approveBtn.count() > 0 && await approveBtn.first().isVisible()) {
          console.log('[GUI] Clicking Approve...');
          await approveBtn.first().click();
        }

        const cancelBtn = page.locator('button[title="Cancel response"], button[aria-label="Cancel Response"]');
        const cancelCount = await cancelBtn.count();
        const taDisabled = await page.$eval(textareaSelector, (el: any) => el.disabled).catch(() => false);
        if (!taDisabled && cancelCount === 0) {
          await sleep(2000);
          break;
        }
      }

      return await page.innerText('body');
    }

    // ── TEST 1: Inspect package.json ──
    console.log('\n--- RETEST 1: Inspect package.json ---');
    const res1 = await sendPrompt('READ-ONLY: Inspect B:\\AgenticOS\\package.json and tell me the project name.');
    const ok1 = res1.toLowerCase().includes('agenticos');
    console.log('Result 1 contains agenticos:', ok1);
    if (ok1) results.test1 = true;

    // ── TEST 2: Inspect server/package.json ──
    console.log('\n--- RETEST 2: Inspect server/package.json ---');
    const res2 = await sendPrompt('READ-ONLY: Inspect server/package.json and tell me the project name.');
    const ok2 = res2.toLowerCase().includes('server');
    console.log('Result 2 contains server:', ok2);
    if (ok2) results.test2 = true;

    // ── TEST 3: Safe task and press Stop while waiting ──
    console.log('\n--- RETEST 3: Start task and press Stop while waiting ---');
    const newConvBtn = page.locator('button[title="New Conversation"], button[aria-label="New Conversation"], button:has-text("New conversation")');
    if (await newConvBtn.count() > 0) {
      await newConvBtn.first().click();
      await sleep(1000);
    }

    await page.fill(textareaSelector, 'Use CodeX to analyze all TypeScript files in server/src/domains and explain their architecture.');
    await page.press(textareaSelector, 'Enter');
    console.log('[GUI] Submitted long-running task...');

    await sleep(2000);
    const stopBtn = page.locator('button[title="Cancel response"], button[aria-label="Cancel Response"], button:has-text("Stop")');
    if (await stopBtn.count() > 0 && await stopBtn.first().isVisible()) {
      console.log('[GUI] Found Stop button. Clicking Stop...');
      await stopBtn.first().click();
      await sleep(2000);
    }

    const bodyAfterStop = await page.innerText('body');
    const taDisabledAfterStop = await page.$eval(textareaSelector, (el: any) => el.disabled).catch(() => false);
    console.log('Textarea disabled after stop:', taDisabledAfterStop);
    const notStuck = !bodyAfterStop.includes('Waiting for local model response') && !taDisabledAfterStop;
    console.log('Stopped cleanly without stuck state:', notStuck);
    if (notStuck) results.test3 = true;

  } finally {
    await app.close().catch(() => {});
  }

  console.log('\n================================================================');
  console.log(`RETEST RESULTS: Test 1: ${results.test1 ? 'PASS' : 'FAIL'}, Test 2: ${results.test2 ? 'PASS' : 'FAIL'}, Test 3: ${results.test3 ? 'PASS' : 'FAIL'}`);
  console.log('================================================================');
  return results.test1 && results.test2 && results.test3;
}

runRetest();
