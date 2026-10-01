const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

async function main() {
  const profileDir = 'C:\\Users\\cd-pr\\AppData\\Roaming\\AgenticOS\\data\\browser_profiles\\freecash-main';
  const storageStatePath = path.join(profileDir, 'storage_state.json');
  
  console.log('Launching browser with persistent profile...');
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: true,
    viewport: { width: 1280, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    args: ['--disable-blink-features=AutomationControlled', '--no-default-browser-check']
  });

  if (fs.existsSync(storageStatePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(storageStatePath, 'utf8'));
      if (data.cookies) {
        await context.addCookies(data.cookies);
        console.log(`Loaded ${data.cookies.length} cookies.`);
      }
    } catch (e) {
      console.error('Error loading storage state:', e.message);
    }
  }

  const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();

  console.log('Navigating to https://freecash.com/earn...');
  await page.goto('https://freecash.com/earn', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(e => {
    console.log('Navigation warning:', e.message);
  });

  await page.waitForTimeout(5000);

  console.log('Current URL:', page.url());
  const title = await page.title();
  console.log('Page title:', title);

  const screenshotPath = 'D:\\AgenticOS\\scratch_freecash_earn.png';
  await page.screenshot({ path: screenshotPath, fullPage: false });
  console.log('Screenshot saved to:', screenshotPath);

  // Search DOM for "Lost Gate" or "Lost" or "Gate"
  const content = await page.content();
  console.log('Searching for "Lost Gate" in page content...');
  const matches = content.match(/.{0,50}Lost Gate.{0,50}/gi) || [];
  console.log('Matches for "Lost Gate":', matches);

  // Let's also search for "Lost" or "Gate"
  const lostMatches = content.match(/.{0,30}Lost.{0,30}/gi) || [];
  console.log('Sample matches for "Lost":', lostMatches.slice(0, 10));

  // Look for search input on FreeCash earn page
  const searchInput = await page.$('input[placeholder*="Search" i], input[type="search" i], input[placeholder*="Suchen" i]');
  if (searchInput) {
    console.log('Found search input, typing "Lost Gate"...');
    await searchInput.fill('Lost Gate');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(4000);
    const searchScreenshot = 'D:\\AgenticOS\\scratch_freecash_search.png';
    await page.screenshot({ path: searchScreenshot, fullPage: false });
    console.log('Search screenshot saved.');

    const newContent = await page.content();
    const newMatches = newContent.match(/.{0,60}Lost Gate.{0,60}/gi) || [];
    console.log('New matches after search:', newMatches);

    // Also look for cards or links
    const cards = await page.$$eval('[data-testid*="offer" i], a[href*="offer"], div[class*="offer-card" i], div[class*="OfferCard" i]', els => 
      els.map(e => ({ text: e.innerText?.slice(0, 100), href: e.getAttribute('href') })).filter(e => e.text)
    );
    console.log('Found offer cards count:', cards.length, 'sample:', cards.slice(0, 10));
  } else {
    console.log('No search input found directly.');
  }

  await context.close();
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
