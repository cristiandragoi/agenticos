import { chromium } from 'playwright';

async function clickGoogleLogin() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const context = browser.contexts()[0];
  const page = context.pages().find(p => p.url().includes('freecash.com'));
  if (!page) {
    console.log('No freecash page found');
    return;
  }

  // Open login modal if not open
  const googleBtn = page.locator('button:has-text("Über Google anmelden"), a:has-text("Über Google anmelden"), :has-text("Registrieren mit Google")').first();
  if (await googleBtn.isVisible()) {
    console.log('Clicking Google login button...');
    await googleBtn.click();
  } else {
    // Click Anmelden first
    const anmelden = page.locator('button:has-text("Anmelden")').first();
    if (await anmelden.isVisible()) {
      await anmelden.click();
      await page.waitForTimeout(2000);
      const btn = page.locator('button:has-text("Über Google anmelden"), :has-text("Google")').first();
      console.log('Clicking Google button inside modal...');
      await btn.click();
    }
  }

  await page.waitForTimeout(5000);
  console.log('Active page URL after click:', page.url());

  // Check if a popup or new tab was opened
  for (const p of context.pages()) {
    console.log('Tab:', p.url(), 'Title:', await p.title());
  }

  await page.screenshot({ path: 'C:\\Users\\cd-pr\\.gemini\\antigravity-ide\\brain\\9bfd03bd-f6e4-4813-a4ee-3b9367106549\\google_login_attempt.png' });
}

clickGoogleLogin().catch(console.error);
