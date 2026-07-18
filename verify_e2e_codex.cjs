const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const artifactsDir = process.env.ARTIFACTS_DIR || __dirname;

  console.log('Navigating to CodeX Studio...');
  await page.goto('http://localhost:5173/#/codex');
  await page.waitForTimeout(2000);

  // Take screenshot of empty state
  await page.screenshot({ path: path.join(artifactsDir, '01_codex_empty.png') });
  
  // Submit a goal
  console.log('Typing goal...');
  await page.fill('.codex-chat__textarea', 'Create a new python script hello.py that prints Hello World');
  await page.click('.codex-chat__send');
  
  console.log('Waiting for plan generation...');
  await page.waitForTimeout(4000); // Wait for /api/chat/quick
  
  // Start the goal
  console.log('Starting goal execution...');
  await page.click('.codex-start-btn');
  
  // Let it run for a bit to generate events
  console.log('Waiting 15 seconds for execution and tool usage...');
  await page.waitForTimeout(15000);
  
  // Screenshot Chat tab
  console.log('Screenshotting Chat tab...');
  await page.screenshot({ path: path.join(artifactsDir, '02_codex_chat_running.png') });

  // Screenshot Plan tab
  console.log('Screenshotting Plan tab...');
  await page.click('text=Plan');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(artifactsDir, '03_codex_plan.png') });

  // Screenshot Files tab
  console.log('Screenshotting Files tab...');
  await page.click('text=Files');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(artifactsDir, '04_codex_files.png') });

  // Screenshot Diff tab
  console.log('Screenshotting Diff tab...');
  await page.click('text=Diff');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(artifactsDir, '05_codex_diff.png') });

  await browser.close();
  console.log('End-to-End Operational test complete.');
})();
