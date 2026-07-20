import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  try {
    console.log('Navigating to CodeX Studio...');
    await page.goto('http://localhost:5173/codex');
    await page.waitForTimeout(2000); 

    const inputLocator = page.locator('input').first();

    // Case 1: B:\AgenticOS
    console.log('Testing B:\\AgenticOS...');
    await inputLocator.fill('B:\\AgenticOS');
    await page.waitForTimeout(1000); 
    await page.screenshot({ path: 'screenshot_case1.png' });
    console.log('Took screenshot: screenshot_case1.png');

    // Case 2: B:\AgenticOS\server
    console.log('Testing B:\\AgenticOS\\server...');
    await inputLocator.fill('B:\\AgenticOS\\server');
    await page.waitForTimeout(1000); 
    await page.screenshot({ path: 'screenshot_case2.png' });
    console.log('Took screenshot: screenshot_case2.png');

  } catch (err) {
    console.error('Error during testing:', err);
  } finally {
    await browser.close();
  }
})();
