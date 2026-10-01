import { chromium } from 'playwright';
import path from 'path';

async function testLaunch() {
  const profileDir = path.join(process.env.TEMP || 'C:\\Temp', 'agenticos-test-browser');
  console.log('Launching browser with profileDir:', profileDir);
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    channel: 'chrome',
    args: [
      '--start-maximized',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-session-crashed-bubble',
      '--disable-infobars',
      '--restore-last-session=false',
      '--remote-debugging-port=9223',
    ],
    viewport: null,
  });
  console.log('Browser launched successfully!');
  const page = context.pages()[0] || await context.newPage();
  console.log('Navigating to youtube.com...');
  await page.goto('https://www.youtube.com/', { waitUntil: 'domcontentloaded' });
  console.log('Navigated! Current URL:', page.url());
  console.log('Waiting 5 seconds...');
  await new Promise((r) => setTimeout(r, 5000));
  await context.close();
  console.log('Done test.');
}

testLaunch().catch(console.error);
