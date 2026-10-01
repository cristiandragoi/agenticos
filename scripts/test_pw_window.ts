import { chromium } from 'playwright';

async function test() {
  console.log('Launching playwright chromium...');
  const browser = await chromium.launch({
    headless: false,
    args: ['--start-maximized']
  });
  console.log('Creating context...');
  const context = await browser.newContext({ viewport: null });
  console.log('Creating page...');
  const page = await context.newPage();
  console.log('Navigating to YouTube...');
  await page.goto('https://www.youtube.com');
  console.log('Navigated! Title:', await page.title());

  console.log('Holding open for 15s to check window state...');
  await new Promise(r => setTimeout(r, 15000));
  await browser.close();
  console.log('Closed.');
}

test().catch(console.error);
