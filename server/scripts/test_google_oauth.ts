import { chromium } from 'playwright';

async function navigateToGoogleOAuth() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const context = browser.contexts()[0];
  const page = context.pages().find(p => p.url().includes('freecash.com'));
  if (!page) return;

  console.log('Navigating to Google OAuth URL...');
  await page.goto('https://freecash.com/fc-api/auth/google?nextUrl=https%3A%2F%2Ffreecash.com%2Fapi%2Foauth%2Fcallback%3Flng%3Dde', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);

  console.log('Current URL after OAuth redirect:', page.url());
  console.log('Page Title:', await page.title());

  await page.screenshot({ path: 'C:\\Users\\cd-pr\\.gemini\\antigravity-ide\\brain\\9bfd03bd-f6e4-4813-a4ee-3b9367106549\\google_oauth_landing.png' });
  console.log('Saved screenshot to google_oauth_landing.png');
}

navigateToGoogleOAuth().catch(console.error);
