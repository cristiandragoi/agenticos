import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  try {
    console.log('Navigating to CodeX Studio...');
    await page.goto('http://localhost:5173/codex');
    await page.waitForTimeout(2000); 

    // Setup Goal
    const promptInput = page.locator('textarea').first();
    await promptInput.fill('Run a provider test');

    // Make sure we have a valid workspace path
    const inputLocator = page.locator('input').first();
    await inputLocator.fill('B:\\AgenticOS');
    await page.waitForTimeout(1000); 

    // Select Ollama (Local) for both providers
    // Wait, the selects don't have good locators. I'll just click them.
    const selects = page.locator('select');
    await selects.nth(0).selectOption('ollama'); // Execution Provider
    await selects.nth(1).selectOption('ollama'); // Validation Provider

    await page.screenshot({ path: 'screenshot_provider_setup.png' });
    console.log('Took screenshot: screenshot_provider_setup.png');

    // Click Review Goal
    console.log('Clicking Review Goal...');
    await page.locator('button:has-text("Review Goal")').click();
    await page.waitForTimeout(3000); // Wait for plan

    await page.screenshot({ path: 'screenshot_preflight.png' });
    console.log('Took screenshot: screenshot_preflight.png');

    // Verify logs
    page.on('console', msg => console.log('BROWSER LOG:', msg.text()));

    // Click Approve & Start
    console.log('Clicking Approve & Start...');
    const startButton = page.locator('button:has-text("Approve & Start")');
    if (await startButton.isVisible()) {
      await startButton.click();
      await page.waitForTimeout(4000); 

      await page.screenshot({ path: 'screenshot_started.png' });
      console.log('Took screenshot: screenshot_started.png');
    } else {
      console.log('Approve & Start button not visible!');
    }

  } catch (err) {
    console.error('Error during testing:', err);
  } finally {
    await browser.close();
  }
})();
