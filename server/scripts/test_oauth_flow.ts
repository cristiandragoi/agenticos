import { chromium } from 'playwright';

async function testOAuthFlow() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const context = browser.contexts()[0];
  const page = context.pages().find(p => p.url().includes('freecash.com'));
  if (!page) return;

  context.on('page', newPage => {
    console.log('[NEW POPUP TAB]:', newPage.url());
  });

  // Switch to Anmelden modal if on Konto erstellen
  const switchToLogin = page.locator('span:has-text("Anmelden"), a:has-text("Anmelden"), button:has-text("Anmelden")').last();
  if (await switchToLogin.isVisible()) {
    console.log('Switching to Anmelden...');
    await switchToLogin.click();
    await page.waitForTimeout(1500);
  }

  const googleBtn = page.locator('button:has-text("Über Google anmelden"), a:has-text("Über Google anmelden"), button:has-text("Mit Google anmelden")').first();
  console.log('Clicking Google button...');
  const [popup] = await Promise.all([
    page.waitForEvent('popup', { timeout: 10000 }).catch(() => null),
    googleBtn.click()
  ]);

  if (popup) {
    console.log('POPUP DETECTED URL:', popup.url());
    await popup.waitForLoadState('domcontentloaded');
    console.log('POPUP TITLE:', await popup.title());
    await popup.screenshot({ path: 'C:\\Users\\cd-pr\\.gemini\\antigravity-ide\\brain\\9bfd03bd-f6e4-4813-a4ee-3b9367106549\\google_popup.png' });
  } else {
    console.log('No popup detected. Checking current page URL:', page.url());
  }

  await page.waitForTimeout(3000);
  for (const p of context.pages()) {
    console.log('Context page:', p.url(), 'Title:', await p.title());
  }
}

testOAuthFlow().catch(console.error);
