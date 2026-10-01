import { chromium } from 'playwright';

async function inspectLoginModal() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const context = browser.contexts()[0];
  const page = context.pages().find(p => p.url().includes('freecash.com'));
  if (!page) {
    console.error('No freecash page found');
    return;
  }

  // Click accept cookies if present
  const acceptCookies = page.locator('button:has-text("Alle Cookies akzeptieren"), button:has-text("Accept")').first();
  if (await acceptCookies.isVisible()) {
    console.log('Accepting cookies...');
    await acceptCookies.click();
    await page.waitForTimeout(1000);
  }

  // Click Anmelden button
  const anmeldenBtn = page.locator('button:has-text("Anmelden"), a:has-text("Anmelden"), button:has-text("Sign In"), button:has-text("Log In")').first();
  if (await anmeldenBtn.isVisible()) {
    console.log('Clicking Anmelden (Sign In)...');
    await anmeldenBtn.click();
    await page.waitForTimeout(3000);
  }

  const modalInfo = await page.evaluate(() => {
    const modal = document.querySelector('[role="dialog"], [class*="modal"], [class*="popup"], form');
    const inputs = Array.from(document.querySelectorAll('input')).map(i => ({
      type: i.type,
      name: i.name,
      placeholder: i.placeholder,
      id: i.id,
      ariaLabel: i.getAttribute('aria-label')
    }));
    const buttons = Array.from(document.querySelectorAll('button')).map(b => b.textContent?.trim()).filter(Boolean);
    return {
      modalFound: !!modal,
      inputs,
      buttons: buttons.slice(0, 15)
    };
  });

  console.log('LOGIN MODAL INFO:', JSON.stringify(modalInfo, null, 2));

  const screenshotPath = 'C:\\Users\\cd-pr\\.gemini\\antigravity-ide\\brain\\9bfd03bd-f6e4-4813-a4ee-3b9367106549\\freecash_login_modal.png';
  await page.screenshot({ path: screenshotPath });
  console.log(`Saved screenshot to ${screenshotPath}`);
}

inspectLoginModal().catch(console.error);
