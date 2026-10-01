import { spawn } from 'child_process';
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { WindowsBrowserWindowHelper } from '../server/src/services/browser/browserSession.js';

async function test() {
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const exe = fs.existsSync(chromePath) ? chromePath : edgePath;
  console.log('Selected browser executable:', exe);

  const profileDir = path.join(process.env.TEMP || 'C:\\Temp', 'agenticos-visible-browser');
  if (!fs.existsSync(profileDir)) {
    fs.mkdirSync(profileDir, { recursive: true });
  }

  const port = 9223;
  console.log(`Connecting or spawning visible browser on port ${port}...`);
  let isRunning = false;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`);
    if (res.ok) isRunning = true;
  } catch {}

  if (!isRunning) {
    const proc = spawn(exe, [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--start-maximized',
      'about:blank'
    ], {
      detached: true,
      stdio: 'ignore'
    });
    proc.unref();

    for (let i = 0; i < 30; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/json/version`);
        if (res.ok) break;
      } catch {}
      await new Promise(r => setTimeout(r, 200));
    }
  }

  console.log('CDP endpoint ready! Connecting Playwright...');
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const contexts = browser.contexts();
  const context = contexts[0] || await browser.newContext();
  const pages = context.pages();
  const page = pages[0] || await context.newPage();

  console.log('Waiting for initial page ready...');
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForTimeout(500);

  console.log('Navigating to YouTube...');
  try {
    await page.goto('https://www.youtube.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch (err: any) {
    if (err?.message?.includes('interrupted')) {
      console.log('Navigation was interrupted, retrying once...');
      await page.waitForTimeout(500);
      await page.goto('https://www.youtube.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
    } else {
      throw err;
    }
  }

  console.log('Navigated to YouTube! Title:', await page.title());
  console.log('Current URL:', page.url());

  // Inspect desktop window
  const win = WindowsBrowserWindowHelper.inspectWindow(undefined, 'YouTube');
  console.log('Desktop window inspection:', JSON.stringify(win));
  if (win.windowHandle) {
    const brought = WindowsBrowserWindowHelper.bringToForeground(win.windowHandle);
    console.log('Brought to foreground:', brought);
  }

  // Search YouTube for "C Adler TV"
  console.log('Searching for "C Adler TV"...');
  const searchInput = page.locator('input[name="search_query"], input#search');
  await searchInput.waitFor({ timeout: 15000 });
  await searchInput.fill('C Adler TV');
  await searchInput.press('Enter');
  await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
  console.log('Search completed! URL:', page.url(), 'Title:', await page.title());

  console.log('Verification successful! Disconnecting CDP...');
  // Note: disconnect CDP, do NOT close browser so it stays open for the user!
  // await browser.close();
}

test().catch(console.error);
