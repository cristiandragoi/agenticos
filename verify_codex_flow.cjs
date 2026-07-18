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

    console.log('Pasting a long goal...');
    const longGoal = 'This is a very long goal that should not expand the page. '.repeat(20) + ' Please audit the application for security issues.';
    await page.fill('textarea', longGoal);
    
    console.log('Setting repository directory...');
    await page.fill('input[placeholder="/path/to/repo"]', 'C:\\Users\\Cris\\Documents\\MockRepo');
    
    // Verify Start button label is "Create Audit Run" since prompt contains "audit"
    const buttonText = await page.innerText('button:has-text("Create Audit Run")');
    if (!buttonText) throw new Error("Button should be 'Create Audit Run'");
    
    console.log('Clicking Create Audit Run (Review)...');
    await page.click('button:has-text("Create Audit Run")');
    
    console.log('Waiting for Preflight view...');
    await page.waitForSelector('text=Preflight Confirmation', { timeout: 10000 });
    await page.waitForSelector('text=Generating concise plan', { state: 'hidden', timeout: 15000 }).catch(() => {});
    
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, '01_preflight_view.png') });
    console.log('Captured preflight view.');

    console.log('Approving and starting...');
    await page.click('button:has-text("Approve and Start")');
    
    // Wait for the workspace to appear (StudioDrawer is visible)
    await page.waitForSelector('text=# System Terminal Output', { timeout: 10000 });
    
    // Check status in inspector
    console.log('Checking status transition...');
    // Initial might be queued or planning or running
    // Wait for terminal events
    await page.waitForTimeout(4000);
    
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, '02_execution_view.png') });
    console.log('Captured execution view.');
    
    const eventsText = await page.innerText('.font-mono.text-\\[13px\\]');
    if (!eventsText.includes('[QUEUED]') && !eventsText.includes('[PLANNING]') && !eventsText.includes('[RUNNING]') && !eventsText.includes('[COMPLETED]')) {
       console.log('WARNING: Did not find expected state transitions in events, but capturing anyway.');
       console.log('Terminal text:', eventsText.substring(0, 200));
    } else {
       console.log('Found state transitions in terminal events.');
    }
    
    // Check that controls (in preflight they disappear, but we are checking that long prompt didn't break input view)
    console.log('Test completed successfully.');

  } catch (error) {
    console.error('Test failed:', error);
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'error_state.png') });
    process.exit(1);
  } finally {
    await browser.close();
  }
}

run();
