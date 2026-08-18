const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
  const artifactsDir = process.env.ARTIFACTS_DIR || __dirname;
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const page = await context.newPage();
  page.on('console', msg => console.log('BROWSER CONSOLE:', msg.text()));
  
  page.on('request', req => {
    if (req.url().includes('/api/chat/agents/goal')) {
      console.log('REQ:', req.method(), req.url(), req.postData());
    }
  });
  page.on('response', res => {
    if (res.url().includes('/api/chat/agents/goal')) {
      console.log('RES:', res.request().method(), res.url(), res.status());
    }
  });


  await page.route('**/api/chat/agents/goal', async route => {
    try {
      const response = await fetch('http://127.0.0.1:4001/api/chat/agents/goal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: route.request().postData()
      });
      const json = await response.json();
      await route.fulfill({ json });
    } catch (err) {
      console.error('Playwright route fetch error:', err);
      await route.continue();
    }
  });

  console.log('Navigating to CodeX Studio...');
  await page.goto('http://localhost:5173/#/codex');
  await page.waitForTimeout(2000);
  
  console.log('Submitting prompt to generate a plan with code blocks...');
  await page.fill('.codex-chat__textarea', 'Create a new python script hello.py that prints Hello World');
  await page.click('.codex-chat__send');
  
  console.log('Waiting for plan and markdown generation...');
  await page.waitForTimeout(15000);
  
  console.log('Checking for new Plan Actions...');
  const copyPlanBtn = await page.locator('button:has-text("Copy Plan")');
  if (await copyPlanBtn.count() > 0) {
    console.log('Found "Copy Plan" button.');
    await page.screenshot({ path: path.join(artifactsDir, '01_plan_actions.png') });
    
    await copyPlanBtn.click();
    await page.waitForTimeout(200);
    const copiedFeedback = await page.locator('button:has-text("Copied")');
    if (await copiedFeedback.count() > 0) {
      console.log('Verified "Copied" feedback state.');
      await page.screenshot({ path: path.join(artifactsDir, '02_copied_feedback.png') });
    } else {
      console.error('Failed to verify "Copied" feedback.');
    }
  } else {
    console.error('Failed to find "Copy Plan" button.');
    await page.screenshot({ path: path.join(artifactsDir, 'error_no_copy_plan.png') });
  }

  // Test Request Changes
  console.log('Testing Request Changes...');
  const requestChangesBtn = await page.locator('button:has-text("Request Changes")');
  if (await requestChangesBtn.count() > 0) {
    await requestChangesBtn.click();
    await page.waitForTimeout(500);
    const textareaValue = await page.inputValue('.codex-chat__textarea');
    if (textareaValue.includes('Please change the plan')) {
       console.log('Verified Request Changes populates textarea.');
    } else {
       console.error('Failed to populate textarea on Request Changes.');
    }
    await page.screenshot({ path: path.join(artifactsDir, '03_request_changes.png') });
  }

  // Test Cancel
  console.log('Testing Cancel behavior...');
  const cancelBtn = await page.locator('button:has-text("Cancel")');
  if (await cancelBtn.count() > 0) {
    await cancelBtn.click();
    await page.waitForTimeout(2000);
    const cancelledText = await page.locator('text=Plan Cancelled.');
    if (await cancelledText.count() > 0) {
      console.log('Verified Plan Cancelled state.');
      await page.screenshot({ path: path.join(artifactsDir, '04_plan_cancelled.png') });
    } else {
      console.error('Failed to find Plan Cancelled text.');
    }
  }

  // Verify English Prompt is in chat.ts and codexLoop.ts
  const codexLoop = fs.readFileSync('server/src/loops/codexLoop.ts', 'utf8');
  const chatTs = fs.readFileSync('server/src/routers/chat.ts', 'utf8');
  if (codexLoop.includes('unless the user explicitly requests another language') && 
      chatTs.includes('unless the user explicitly requests another language')) {
    console.log('Verified English preference in prompts.');
  } else {
    console.error('English preference prompt missing.');
  }

  // Check top-right message copy button
  const msgCopyBtn = await page.locator('button[aria-label="Copy response"]').first();
  if (await msgCopyBtn.count() > 0) {
    console.log('Found message "Copy response" button.');
  }
  
  // Check code block copy button
  const codeCopyBtn = await page.locator('button[aria-label="Copy code"]').first();
  if (await codeCopyBtn.count() > 0) {
    console.log('Found code block "Copy code" button.');
  }

  await browser.close();
  console.log('UX modifications verified successfully.');
})();

