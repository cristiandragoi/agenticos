import { chromium } from 'playwright';

async function inspectEarnPage() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const context = browser.contexts()[0];
  const page = context.pages().find(p => p.url().includes('freecash.com')) || context.pages()[0];

  console.log('Navigating to https://freecash.com/earn...');
  await page.goto('https://freecash.com/earn', { waitUntil: 'networkidle', timeout: 30000 }).catch(async () => {
    await page.waitForLoadState('domcontentloaded');
  });

  await page.waitForTimeout(4000);

  const url = page.url();
  const title = await page.title();
  console.log('Navigated URL:', url);
  console.log('Title:', title);

  // Take screenshot
  const ssPath = 'C:\\Users\\cd-pr\\.gemini\\antigravity-ide\\brain\\9bfd03bd-f6e4-4813-a4ee-3b9367106549\\freecash_earn_page.png';
  await page.screenshot({ path: ssPath, fullPage: false });
  console.log('Saved screenshot to:', ssPath);

  // Evaluate DOM
  const data = await page.evaluate(() => {
    // Look for user profile, username, balance
    const text = document.body.innerText;
    
    // Look for links / tabs
    const navLinks = Array.from(document.querySelectorAll('nav a, header a, [class*="nav"] a')).map(a => ({
      text: a.textContent?.trim(),
      href: (a as HTMLAnchorElement).href
    }));

    // Look for offer items or sections
    const cards = Array.from(document.querySelectorAll('a[href*="/offer/"], [class*="offer"], [data-test*="offer"], [class*="card"]')).map(el => {
      const title = el.querySelector('h1, h2, h3, h4, h5, [class*="title"], [class*="name"]')?.textContent?.trim() || el.getAttribute('aria-label') || '';
      const payout = el.querySelector('[class*="payout"], [class*="reward"], [class*="price"], [class*="coins"], [class*="amount"]')?.textContent?.trim() || '';
      const category = el.querySelector('[class*="category"], [class*="type"], [class*="badge"]')?.textContent?.trim() || '';
      const href = (el as HTMLAnchorElement).href || el.querySelector('a')?.href || '';
      return { title, payout, category, href };
    }).filter(c => c.title || c.payout);

    // Any buttons like "Start", "Play", "Install", etc.
    const actionButtons = Array.from(document.querySelectorAll('button')).map(b => b.textContent?.trim()).filter(Boolean).slice(0, 20);

    return {
      url: window.location.href,
      navLinks: navLinks.slice(0, 10),
      cardsCount: cards.length,
      sampleCards: cards.slice(0, 15),
      actionButtons,
      first500Chars: text.slice(0, 500)
    };
  });

  console.log('EVAL DATA:', JSON.stringify(data, null, 2));
}

inspectEarnPage().catch(console.error);
