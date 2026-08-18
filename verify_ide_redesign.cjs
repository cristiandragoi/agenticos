const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ARTIFACTS_DIR = process.env.ARTIFACTS_DIR || process.cwd();

async function run() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  try {
    console.log('Navigating to CodeX Studio...');
    await page.goto('http://localhost:5173/#/codex');
    await page.waitForTimeout(1000);

    // 1. Capture Empty IDE state
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, '01_ide_empty_state.png') });
    console.log('Captured IDE empty state.');

    console.log('Opening Settings...');
    await page.click('button[title="Execution Settings"]');
    await page.waitForTimeout(500);
    await page.fill('input[value="C:\\\\Users\\\\Cris\\\\Documents\\\\MockRepo"]', '/custom/workspace/path');

    console.log('Sending message...');
    await page.fill('textarea[placeholder="Message CodeX..."]', 'Build a shared World Brain');
    await page.click('button[title="Send message"]');
    
    // 2. Capture Planning state
    await page.waitForSelector('text=CodeX is thinking...', { timeout: 10000 });
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, '02_ide_planning.png') });
    console.log('Captured IDE planning state.');

    // 3. Capture Plan Ready state
    await page.waitForSelector('button:has-text("Start")', { timeout: 15000 });
    await page.waitForTimeout(500); // let UI settle
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, '03_ide_plan_ready.png') });
    console.log('Captured IDE plan ready state.');

    console.log('Clicking Start...');
    await page.click('button:has-text("Start")');
    
    // 4. Capture Execution state
    // Wait for the terminal to appear in the drawer (it auto-opens)
    await page.waitForSelector('text=# System Terminal Output', { timeout: 10000 });
    await page.waitForTimeout(3000); // wait for some events
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, '04_ide_execution.png') });
    console.log('Captured IDE execution state.');
    
    console.log('Test completed successfully.');

  } catch (error) {
    console.error('Test failed:', error);
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'error_state_ide.png') });
    process.exit(1);
  } finally {
    await browser.close();
  }
}

run();
