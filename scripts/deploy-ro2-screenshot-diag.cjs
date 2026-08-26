/* RO2 diagnostic: screenshot + button geometry */
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await page.goto('http://localhost:4599/#/revenue', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(5000);
  await page.screenshot({ path: 'B:/AgenticOS/workspace/root/ro2-kpi-strip.png' });
  await page.locator('[data-testid="tab-digital_products"]').click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'B:/AgenticOS/workspace/root/ro2-digital-kanban.png' });
  await page.locator('[data-testid^="card-"]').first().click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'B:/AgenticOS/workspace/root/ro2-drawer.png' });
  const geo = await page.evaluate(() => {
    const b = document.querySelector('[data-testid="drawer-close"]');
    if (!b) return 'button not found';
    const r = b.getBoundingClientRect();
    const cs = getComputedStyle(b);
    return `rect=${JSON.stringify({x: r.x, y: r.y, w: r.width, h: r.height})} display=${cs.display} visibility=${cs.visibility} zIndexParent=${getComputedStyle(b.closest('.sticky') || b.parentElement).zIndex}`;
  });
  console.log('button geometry:', geo);
  await browser.close();
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
