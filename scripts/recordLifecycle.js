import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

const ARTIFACTS_DIR = process.env.ARTIFACTS_DIR || process.cwd();

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: 'dark',
    recordVideo: {
      dir: ARTIFACTS_DIR,
      size: { width: 1440, height: 900 }
    }
  });
  const page = await context.newPage();

  console.log('Navigating to CodeX Studio...');
  await page.goto('http://localhost:5173/#/codex');
  await page.waitForSelector('text="CodeX Goal Mode"', { timeout: 15000 });
  await page.waitForTimeout(2000);

  await page.fill('textarea', 'Create a simple math utility and write tests for it.');
  await page.waitForTimeout(1000);

  await page.click('button:has-text("Start Autonomous Goal")');
  await page.waitForTimeout(4000);

  await page.waitForTimeout(2000);

  await page.click('button:has-text("Plan")');
  await page.waitForTimeout(3000);

  await page.click('button:has-text("Board")');
  await page.waitForTimeout(3000);

  await page.click('button:has-text("Files")');
  await page.waitForTimeout(3000);

  await page.click('button:has-text("Terminal")');
  await page.waitForTimeout(2000);

  await page.click('button:has-text("Checkpoints")');
  await page.waitForTimeout(2000);

  await page.click('button:has-text("Pause")');
  await page.waitForTimeout(3000);

  // Resume might not exist if it's not paused, or we can just try
  try {
    await page.click('button:has-text("Resume")', { timeout: 3000 });
    await page.waitForTimeout(3000);
  } catch (e) {}

  await context.close();
  await browser.close();
  
  // Find the generated webm file in ARTIFACTS_DIR and rename it to lifecycle.webm
  const files = fs.readdirSync(ARTIFACTS_DIR);
  const webmFile = files.find(f => f.endsWith('.webm') && f !== 'lifecycle.webm');
  if (webmFile) {
    fs.renameSync(path.join(ARTIFACTS_DIR, webmFile), path.join(ARTIFACTS_DIR, 'lifecycle.webm'));
  }

  console.log('Video recording complete.');
}

run().catch(console.error);
