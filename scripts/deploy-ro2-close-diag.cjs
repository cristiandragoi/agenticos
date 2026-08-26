/* RO2 diagnostic: drawer-close click behavior */
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await page.goto('http://localhost:4599/#/revenue', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(5000);
  await page.locator('[data-testid="tab-digital_products"]').click();
  await page.waitForTimeout(1500);
  await page.locator('[data-testid^="card-"]').first().click();
  await page.waitForTimeout(1500);
  console.log('drawer open:', await page.locator('[data-testid="experiment-drawer"]').count());

  // attempt 1: force click
  await page.locator('[data-testid="drawer-close"]').click({ force: true });
  await page.waitForTimeout(1000);
  console.log('after force click, drawer count:', await page.locator('[data-testid="experiment-drawer"]').count());

  // attempt 2: DOM click
  await page.evaluate(() => document.querySelector('[data-testid="drawer-close"]')?.click());
  await page.waitForTimeout(1000);
  console.log('after DOM click, drawer count:', await page.locator('[data-testid="experiment-drawer"]').count());

  // button box
  const box = await page.locator('[data-testid="drawer-close"]').boundingBox().catch(() => null);
  console.log('button box:', JSON.stringify(box));
  await browser.close();
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
