import { chromium } from 'playwright';

async function checkFreeCashSession() {
  console.log('Connecting to Chrome CDP on port 9223...');
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const contexts = browser.contexts();
  const context = contexts[0] || await browser.newContext();
  
  // Find or create a page
  const pages = context.pages();
  let page = pages.find(p => p.url().includes('freecash.com'));
  if (!page) {
    console.log('Opening new tab for freecash.com...');
    page = await context.newPage();
    await page.goto('https://freecash.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
  } else {
    console.log('Found existing freecash tab:', page.url());
  }

  await page.waitForTimeout(4000);
  const currentUrl = page.url();
  const title = await page.title();
  console.log(`Current URL: ${currentUrl}`);
  console.log(`Page Title: ${title}`);

  // Check cookies for freecash
  const cookies = await context.cookies(['https://freecash.com']);
  console.log(`Found ${cookies.length} cookies for freecash.com:`);
  for (const c of cookies) {
    console.log(` - ${c.name} (domain: ${c.domain}, expires: ${c.expires})`);
  }

  // Inspect DOM for login / auth state
  // Check for common Freecash auth indicators: user profile, balance, login/sign-in button
  const authElements = await page.evaluate(() => {
    const bodyText = document.body.innerText;
    const loginBtns = Array.from(document.querySelectorAll('button, a')).filter(el => {
      const t = (el.textContent || '').trim().toLowerCase();
      return t === 'sign in' || t === 'log in' || t === 'login' || t === 'sign up' || t === 'register';
    }).map(el => ({ tag: el.tagName, text: el.textContent?.trim(), href: (el as HTMLAnchorElement).href }));

    // Check for balance / profile
    const balanceEls = Array.from(document.querySelectorAll('[data-test*="balance"], [class*="balance"], [id*="balance"], [class*="coins"]')).map(el => el.textContent?.trim());
    const profileEls = Array.from(document.querySelectorAll('[data-test*="user"], [data-test*="profile"], [class*="avatar"], [class*="profile"]')).map(el => el.textContent?.trim());

    return {
      loginBtns: loginBtns.slice(0, 5),
      balanceEls: balanceEls.slice(0, 5),
      profileEls: profileEls.slice(0, 5),
      hasSignInText: bodyText.includes('Sign in') || bodyText.includes('Log In'),
      hasEarnTab: bodyText.includes('Earn') || bodyText.includes('Offers'),
    };
  });

  console.log('AUTH ELEMENTS CHECK:', JSON.stringify(authElements, null, 2));

  const screenshotPath = 'C:\\Users\\cd-pr\\.gemini\\antigravity-ide\\brain\\9bfd03bd-f6e4-4813-a4ee-3b9367106549\\freecash_session_state.png';
  await page.screenshot({ path: screenshotPath, fullPage: false });
  console.log(`Saved screenshot to ${screenshotPath}`);
}

checkFreeCashSession().catch(err => {
  console.error('Error checking Freecash session:', err);
  process.exit(1);
});
