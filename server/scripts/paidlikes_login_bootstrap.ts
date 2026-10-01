/**
 * Manual Login Bootstrap for PaidLikes Canary Profile.
 *
 * Usage:
 *   npx tsx scripts/paidlikes_login_bootstrap.ts
 *
 * Opens Playwright Chromium in headed mode using the persistent profile
 * at data/revenue-operator/profiles/profile_paidlikes_canary_account.
 * Automatically detects successful login to PaidLikes and serializes
 * the session state (including session cookies) to storage_state.json.
 */

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { chromium } from 'playwright';

async function bootstrapLogin() {
  const profileDir = path.resolve(process.cwd(), 'data', 'revenue-operator', 'profiles', 'profile_paidlikes_canary_account');
  const storageStatePath = path.join(profileDir, 'storage_state.json');

  console.log(`[PaidLikes Bootstrap] Launching browser with persistent profile at:\n${profileDir}`);

  if (!fs.existsSync(profileDir)) {
    fs.mkdirSync(profileDir, { recursive: true });
  }

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    viewport: { width: 1280, height: 800 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-default-browser-check',
      '--disable-infobars',
    ],
  });

  const page = await context.newPage();
  await page.goto('https://www.paidlikes.de/login');

  console.log('\n======================================================');
  console.log('   PAIDLIKES ONE-TIME MANUAL LOGIN BOOTSTRAP          ');
  console.log('======================================================');
  console.log('1. Log into your PaidLikes account in the opened browser window.');
  console.log('2. Complete any CAPTCHA if prompted.');
  console.log('3. Login will be AUTO-DETECTED once the memberarea is reached.');
  console.log('4. (Optional) You may also open a tab to YouTube and sign in if you want YouTube tasks.');
  console.log('======================================================\n');

  let detected = false;
  const pollInterval = setInterval(async () => {
    if (detected) return;
    try {
      const url = page.url();
      const hasLogout = await page.$('a[href*="logout"], a[href*="abmelden"]');
      const hasPoints = await page.$('#points, .points, .user-points, .user_points');

      if (url.includes('memberarea') || hasLogout || hasPoints) {
        detected = true;
        clearInterval(pollInterval);
        console.log('\n>>> [PaidLikes Bootstrap] SUCCESSFUL LOGIN DETECTED! <<<');
        console.log(`Current URL: ${url}`);
        console.log('Flushing session state and cookies to storage_state.json...');
        await page.waitForTimeout(2000);
        await context.storageState({ path: storageStatePath });
        console.log(`[PaidLikes Bootstrap] Saved session state to: ${storageStatePath}`);
        console.log('[PaidLikes Bootstrap] Closing browser cleanly in 3 seconds...');
        await page.waitForTimeout(3000);
        await context.close();
        console.log('[PaidLikes Bootstrap] Browser closed cleanly. Persistent session is ready!');
        process.exit(0);
      }
    } catch {
      // Browser might have been closed by user
    }
  }, 1500);

  // Fallback: allow manual Enter
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  rl.question('Or press ENTER at any time to save and exit: ', async () => {
    if (!detected) {
      detected = true;
      clearInterval(pollInterval);
      console.log('[PaidLikes Bootstrap] Saving storage state and closing context...');
      await context.storageState({ path: storageStatePath }).catch(() => {});
      await context.close().catch(() => {});
      console.log('[PaidLikes Bootstrap] Session saved successfully!');
      rl.close();
      process.exit(0);
    }
  });
}

bootstrapLogin().catch((err) => {
  console.error('[PaidLikes Bootstrap] Error:', err);
  process.exit(1);
});
