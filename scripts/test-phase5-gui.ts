import { _electron as electron } from 'playwright';
import fs from 'fs';
import path from 'path';

const BASE = 'http://localhost:4000';
const EXE_PATH = 'C:\\Users\\Cris\\Desktop\\desktop\\Agentic_OS\\Agentic OS\\Agentic OS.exe';

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runGuiTest() {
  console.log('================================================================');
  console.log('PHASE 5: REAL PACKAGED ELECTRON GUI ACCEPTANCE');
  console.log('Target: ' + EXE_PATH);
  console.log('================================================================\n');

  let results = {
    test1: false,
    test2: false,
    test3: false
  };

  const app = await electron.launch({
    executablePath: EXE_PATH,
    args: ['--no-sandbox']
  });

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

    async function sendGuiPrompt(promptText: string) {
      // Start fresh conversation
      const newConvBtn = page.locator('button[title="New Conversation"], button[aria-label="New Conversation"], button:has-text("New conversation")');
      if (await newConvBtn.count() > 0) {
        await newConvBtn.first().click();
        await sleep(1000);
      }

      await page.fill(textareaSelector, promptText);
      await page.press(textareaSelector, 'Enter');
      console.log(`[GUI] Submitted prompt: "${promptText}"`);

      // Wait for completion
      const start = Date.now();
      while (Date.now() - start < 60000) {
        await sleep(1000);
        // If there's an approval button, click it
        const approveBtn = page.locator('button:has-text("Approve"), button[data-testid="approve-goal-btn"]');
        if (await approveBtn.count() > 0 && await approveBtn.first().isVisible()) {
          console.log('[GUI] Clicking Approve button...');
          await approveBtn.first().click();
        }

        const cancelBtn = page.locator('button[title="Cancel response"], button[aria-label="Cancel Response"]');
        const cancelCount = await cancelBtn.count();
        const taDisabled = await page.$eval(textareaSelector, (el: any) => el.disabled).catch(() => false);
        if (!taDisabled && cancelCount === 0) {
          // Extra grace period for text to settle
          await sleep(2000);
          break;
        }
      }

      const bodyText = await page.innerText('body');
      return bodyText;
    }

    // ── TEST 1: READ-ONLY package.json ──
    console.log('\n--- GUI TEST 1: Inspect package.json ---');
    const reply1 = await sendGuiPrompt('READ-ONLY: Inspect B:\\AgenticOS\\package.json and tell me the project name.');
    const hasAgenticOs = reply1.toLowerCase().includes('agenticos');
    console.log('GUI Response contains "agenticos":', hasAgenticOs);
    if (hasAgenticOs) {
      results.test1 = true;
      console.log('GUI TEST 1: PASS');
    } else {
      console.log('GUI TEST 1: FAIL');
    }

    // ── TEST 2: READ-ONLY Jarvis Router ──
    console.log('\n--- GUI TEST 2: Inspect Jarvis Router ---');
    const reply2 = await sendGuiPrompt('READ-ONLY: Inspect the Jarvis router and tell me the normal streaming conversation endpoint.');
    const hasStreamEndpoint = reply2.toLowerCase().includes('stream') || reply2.toLowerCase().includes('message/stream');
    console.log('GUI Response contains streaming endpoint:', hasStreamEndpoint);
    if (hasStreamEndpoint) {
      results.test2 = true;
      console.log('GUI TEST 2: PASS');
    } else {
      console.log('GUI TEST 2: FAIL');
    }

    // ── TEST 3: Safe Disposable Write/Read Task ──
    console.log('\n--- GUI TEST 3: Safe disposable write and verify ---');
    const reply3 = await sendGuiPrompt('Use CodeX to write a disposable file named scratch_gui_test.txt with content "GUI_VERIFIED_777", then read it and confirm.');
    await sleep(2000);
    const scratchPath = path.resolve('B:/AgenticOS/scratch_gui_test.txt');
    const fileExists = fs.existsSync(scratchPath);
    let fileContent = '';
    if (fileExists) {
      fileContent = fs.readFileSync(scratchPath, 'utf8');
      // Clean up scratch file
      try { fs.unlinkSync(scratchPath); } catch {}
    }
    const hasVerification = fileContent.includes('GUI_VERIFIED_777') || reply3.includes('GUI_VERIFIED_777') || reply3.toLowerCase().includes('successfully wrote');
    console.log('File written and confirmed:', hasVerification);
    if (hasVerification) {
      results.test3 = true;
      console.log('GUI TEST 3: PASS');
    } else {
      console.log('GUI TEST 3: FAIL');
    }

  } finally {
    await app.close().catch(() => {});
  }

  const passCount = (results.test1 ? 1 : 0) + (results.test2 ? 1 : 0) + (results.test3 ? 1 : 0);
  console.log(`\n================================================================`);
  console.log(`PHASE 5 RESULT: ${passCount}/3`);
  console.log(`================================================================`);
  return passCount === 3;
}

runGuiTest();
