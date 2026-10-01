import { chromium } from 'playwright';

async function enterGoogleEmail() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const context = browser.contexts()[0];
  const page = context.pages().find(p => p.url().includes('accounts.google.com'));
  if (!page) {
    console.log('No accounts.google.com page found');
    return;
  }

  console.log('Found Google login page:', page.url());
  const emailInput = page.locator('input[type="email"], #identifierId').first();
  if (await emailInput.isVisible()) {
    console.log('Typing email: christiandragoi@gmail.com...');
    await emailInput.fill('christiandragoi@gmail.com');
    await page.waitForTimeout(500);

    const nextBtn = page.locator('button:has-text("Weiter"), #identifierNext button, button:has-text("Next")').first();
    console.log('Clicking Weiter (Next)...');
    await nextBtn.click();
    await page.waitForTimeout(4000);
  }

  console.log('Page URL after email submission:', page.url());
  console.log('Page title:', await page.title());

  const screenshotPath = 'C:\\Users\\cd-pr\\.gemini\\antigravity-ide\\brain\\9bfd03bd-f6e4-4813-a4ee-3b9367106549\\google_password_prompt.png';
  await page.screenshot({ path: screenshotPath });
  console.log('Saved screenshot to:', screenshotPath);
}

enterGoogleEmail().catch(console.error);
