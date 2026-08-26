/* RO2 diagnostic: why drawer sections missing */
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + String(e.message).slice(0, 300)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 300)); });

  await page.goto('http://localhost:4599/#/revenue', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(5000);
  await page.locator('[data-testid="tab-digital_products"]').click();
  await page.waitForTimeout(1500);
  await page.locator('[data-testid^="card-"]').first().click();
  await page.waitForTimeout(2000);

  const drawer = page.locator('[data-testid="experiment-drawer"]');
  console.log('drawer count:', await drawer.count());
  const dt = await drawer.innerText().catch(() => '(innerText failed)');
  console.log('dt length:', dt.length);
  console.log('has "Hypothesis & Evidence":', dt.includes('Hypothesis & Evidence'));
  console.log('has "Canonical Execution Runs":', dt.includes('Canonical Execution Runs'));
  console.log('has "Lifecycle Events":', dt.includes('Lifecycle Events'));
  console.log('has "Ledger Entries":', dt.includes('Ledger Entries'));
  console.log('TAIL 400:', dt.slice(-400).replace(/\n/g, ' | '));
  console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
  const html = await drawer.innerHTML().catch(() => '');
  console.log('innerHTML length:', html.length);
  console.log('html has sections:', html.includes('Canonical Execution Runs'));
  await browser.close();
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
