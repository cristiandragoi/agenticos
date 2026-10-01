import { chromium } from 'playwright';

async function inspectAuthenticatedFreecash() {
  console.log('Connecting to Chrome CDP on port 9223...');
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const context = browser.contexts()[0];
  
  let page = context.pages().find(p => p.url().includes('freecash.com'));
  if (!page) {
    page = context.pages()[0];
    await page.goto('https://freecash.com/earn', { waitUntil: 'domcontentloaded' });
  }

  await page.waitForTimeout(3000);
  const currentUrl = page.url();
  console.log('Current URL:', currentUrl);

  // If on login modal or home, ensure we navigate to /earn
  if (!currentUrl.includes('/earn')) {
    console.log('Navigating to https://freecash.com/earn...');
    await page.goto('https://freecash.com/earn', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);
  }

  const pageInfo = await page.evaluate(() => {
    // Look for balance, user name, coins
    const text = document.body.innerText;
    
    // Extract balance
    const balanceMatch = text.match(/\$[\d,.]+|\d+[\d,.]*\s*Coins/i);
    
    // Extract user profile / avatar / username
    const profileMatch = document.querySelector('[data-test*="profile"], [class*="profile"], [class*="user"], [class*="avatar"]')?.textContent?.trim();

    // Check if sign-in button is still there
    const hasSignIn = !!Array.from(document.querySelectorAll('button, a')).find(el => {
      const t = el.textContent?.trim().toLowerCase();
      return t === 'sign in' || t === 'anmelden' || t === 'log in';
    });

    // Inspect available offers / tasks
    // Look for offer cards
    const offerElements = Array.from(document.querySelectorAll('[data-test*="offer"], [class*="offer-card"], [class*="offerCard"], [class*="OfferCard"], a[href*="/offer/"], div[class*="task"], div[class*="campaign"]'));
    
    // Fallback: look for offer items in sections
    const offers = offerElements.map(el => {
      const title = el.querySelector('h1, h2, h3, h4, h5, [class*="title"], [class*="name"]')?.textContent?.trim() || el.getAttribute('aria-label') || '';
      const payout = el.querySelector('[class*="payout"], [class*="reward"], [class*="price"], [class*="amount"], [class*="coins"]')?.textContent?.trim() || '';
      const desc = el.querySelector('p, [class*="description"], [class*="category"]')?.textContent?.trim() || '';
      const href = (el as HTMLAnchorElement).href || el.querySelector('a')?.href || '';
      return { title, payout, desc, href };
    }).filter(o => o.title || o.payout);

    return {
      title: document.title,
      currentUrl: window.location.href,
      hasSignIn,
      balanceSnippet: balanceMatch ? balanceMatch[0] : null,
      profileSnippet: profileMatch || null,
      offersCount: offers.length,
      offers: offers.slice(0, 30),
      rawSnippet: text.slice(0, 1000)
    };
  });

  console.log('PAGE INFO:', JSON.stringify(pageInfo, null, 2));

  const screenshotPath = 'C:\\Users\\cd-pr\\.gemini\\antigravity-ide\\brain\\9bfd03bd-f6e4-4813-a4ee-3b9367106549\\freecash_authenticated_dashboard.png';
  await page.screenshot({ path: screenshotPath });
  console.log(`Saved screenshot to ${screenshotPath}`);
}

inspectAuthenticatedFreecash().catch(console.error);
