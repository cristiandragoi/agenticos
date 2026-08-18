const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  
  const artifactsDir = process.env.ARTIFACTS_DIR || __dirname;

  console.log('Navigating to Agentic OS...');
  await page.goto('http://localhost:5173/#/mission-control');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(artifactsDir, '01_mission_control.png') });
  console.log('Captured Mission Control.');

  console.log('Navigating to CodeX Studio...');
  await page.goto('http://localhost:5173/#/codex');
  await page.waitForTimeout(2000);
  
  // Start a mock planning session
  await page.click('button[title="Execution Settings"]');
  await page.fill('.codex-chat__textarea', 'Test conversation persistence');
  await page.click('.codex-chat__send');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(artifactsDir, '02_codex_inside_shell.png') });
  console.log('Captured CodeX inside global shell.');

  console.log('Navigating to Models page...');
  await page.goto('http://localhost:5173/#/models');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(artifactsDir, '03_models_registry.png') });
  console.log('Captured Models page.');

  console.log('Navigating to Providers page...');
  await page.goto('http://localhost:5173/#/providers');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(artifactsDir, '04_providers_registry.png') });
  console.log('Captured Providers page.');

  console.log('Navigating back to CodeX Studio...');
  await page.goto('http://localhost:5173/#/codex');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(artifactsDir, '05_codex_state_preserved.png') });
  console.log('Captured CodeX state persistence.');

  console.log('Navigating to Jarvis...');
  await page.goto('http://localhost:5173/#/jarvis');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(artifactsDir, '06_jarvis_workspace.png') });
  console.log('Captured Jarvis.');

  await browser.close();
  console.log('Test completed successfully.');
})();
