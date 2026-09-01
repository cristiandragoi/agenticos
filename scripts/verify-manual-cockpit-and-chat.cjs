const { _electron: electron } = require('playwright');
const path = require('path');
const fs = require('fs');

const EXE_PATH = process.env.AGENTICOS_EXE_PATH || path.resolve(__dirname, '..', 'release', 'win-unpacked', 'AgenticOS.exe');
const PROMPT = 'Explain in two sentences what the current role of Jarvis is inside Agentic OS. Do not delegate this task.';

async function runTest() {
  console.log('[Acceptance] Launching packaged executable:', EXE_PATH);
  const app = await electron.launch({
    executablePath: EXE_PATH,
    args: [],
    timeout: 60000,
  });

  const page = await app.firstWindow();
  console.log('[Acceptance] App window opened. URL:', page.url());

  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(4000);

  const currentUrl = page.url();
  console.log('[Acceptance] Current route:', currentUrl);

  // 1. TEST ON MISSION CONTROL (#/mission-control)
  console.log('\n--- 1. TESTING MISSION CONTROL COCKPIT ---');
  if (!currentUrl.includes('mission-control')) {
    await page.evaluate(() => { window.location.hash = '#/mission-control'; });
    await page.waitForTimeout(2000);
  }

  const inputSelector = 'input[placeholder*="Ask Jarvis"], input[placeholder*="message"], input[type="text"]';
  await page.waitForSelector(inputSelector, { timeout: 15000 });
  const mcInput = page.locator(inputSelector).first();
  await mcInput.fill(PROMPT);
  await mcInput.press('Enter');
  console.log('[Acceptance] Prompt submitted on Mission Control. Waiting 25s for completion & stall window...');

  await page.waitForTimeout(25000);

  const pageTextMC = await page.evaluate(() => document.body.innerText);
  console.log('\n--- Page content snippet (Mission Control) ---');
  console.log(pageTextMC.slice(-1500));

  const hasBodyStreamErrorMC = pageTextMC.includes('BodyStreamBuffer was aborted');
  const hasStaleQueueMC = pageTextMC.includes('queued behind Hermes') || pageTextMC.includes('active 1/1, position 2');
  const hasStallNoticeMC = pageTextMC.includes('no worker activity for 45 seconds');
  const hasJarvisAnswerMC = pageTextMC.includes('Jarvis') && (pageTextMC.includes('operational commander') || pageTextMC.includes('supervisor') || pageTextMC.includes('orchestration') || pageTextMC.includes('role'));

  console.log('\n[Mission Control Checks]:');
  console.log('  - Jarvis Direct Answer Present:', hasJarvisAnswerMC);
  console.log('  - BodyStreamBuffer Error Present:', hasBodyStreamErrorMC);
  console.log('  - Stale Queue Contamination Present:', hasStaleQueueMC);
  console.log('  - Inactivity Stall Notice Present:', hasStallNoticeMC);

  // 2. TEST ON JARVIS STUDIO (#/jarvis)
  console.log('\n--- 2. TESTING JARVIS STUDIO ---');
  await page.evaluate(() => { window.location.hash = '#/jarvis'; });
  await page.waitForTimeout(3000);

  const studioInput = page.locator('textarea[placeholder*="Ask Jarvis"], textarea, input[type="text"]').first();
  await studioInput.fill(PROMPT);
  await studioInput.press('Enter');
  console.log('[Acceptance] Prompt submitted on Jarvis Studio. Waiting 25s for completion & stall window...');

  await page.waitForTimeout(25000);

  const pageTextStudio = await page.evaluate(() => document.body.innerText);
  console.log('\n--- Page content snippet (Jarvis Studio) ---');
  console.log(pageTextStudio.slice(-1500));

  const hasBodyStreamErrorStudio = pageTextStudio.includes('BodyStreamBuffer was aborted');
  const hasStaleQueueStudio = pageTextStudio.includes('queued behind Hermes') || pageTextStudio.includes('active 1/1, position 2');
  const hasStallNoticeStudio = pageTextStudio.includes('no worker activity for 45 seconds');
  const hasJarvisAnswerStudio = pageTextStudio.includes('Jarvis') && (pageTextStudio.includes('operational commander') || pageTextStudio.includes('supervisor') || pageTextStudio.includes('orchestration') || pageTextStudio.includes('role'));

  console.log('\n[Jarvis Studio Checks]:');
  console.log('  - Jarvis Direct Answer Present:', hasJarvisAnswerStudio);
  console.log('  - BodyStreamBuffer Error Present:', hasBodyStreamErrorStudio);
  console.log('  - Stale Queue Contamination Present:', hasStaleQueueStudio);
  console.log('  - Inactivity Stall Notice Present:', hasStallNoticeStudio);

  await app.close();

  if (hasBodyStreamErrorMC || hasStaleQueueMC || hasStallNoticeMC || !hasJarvisAnswerMC ||
      hasBodyStreamErrorStudio || hasStaleQueueStudio || hasStallNoticeStudio || !hasJarvisAnswerStudio) {
    console.error('\n[ACCEPTANCE FAILED]');
    process.exit(1);
  }

  console.log('\n[ACCEPTANCE SUCCESSFUL - ALL CRITERIA MET]');
  process.exit(0);
}

runTest().catch((err) => {
  console.error('[Acceptance Error]', err);
  process.exit(1);
});
