const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  
  const artifactsDir = process.env.ARTIFACTS_DIR || __dirname;

  console.log('Navigating to Agentic OS...');
  await page.goto('http://localhost:5173/#/mission-control');
  await page.waitForTimeout(2000);
  
  await page.screenshot({ path: path.join(artifactsDir, '07_sidebar_cleanup.png') });
  console.log('Captured Sidebar.');

  await browser.close();
  console.log('Test completed successfully.');
})();
