const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  const logs = [];
  page.on('console', msg => {
    logs.push(`[${msg.type()}] ${msg.text()}`);
    console.log(`BROWSER CONSOLE: [${msg.type()}] ${msg.text()}`);
  });

  console.log('Navigating to http://localhost:5173/#/codex');
  await page.goto('http://localhost:5173/#/codex', { waitUntil: 'networkidle' });

  // Wait for the marker or timeout
  try {
    await page.waitForSelector('text="CODEX-STUDIO-REDESIGN-BUILD-2026-07-17-A"', { timeout: 5000 });
    console.log('Build marker found in DOM!');
  } catch (e) {
    console.log('Build marker NOT found in DOM!');
  }

  const artifactsDir = process.env.ARTIFACTS_DIR || process.cwd();
  const screenshotPath = path.join(artifactsDir, 'verify_build.png');
  await page.screenshot({ path: screenshotPath });
  console.log('Saved screenshot to:', screenshotPath);
  
  await browser.close();
})();
