/* RO2 diagnostic: what element is truly topmost at close-button coords + trusted CDP click */
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

  const info = await page.evaluate(() => {
    const b = document.querySelector('[data-testid="drawer-close"]');
    const r = b.getBoundingClientRect();
    const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
    const top = document.elementFromPoint(cx, cy);
    let chain = [];
    let el = top;
    while (el && chain.length < 5) { chain.push(`${el.tagName}${el.dataset?.testid ? '[data-testid=' + el.dataset.testid + ']' : ''}${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ').slice(0, 3).join('.') : ''}`); el = el.parentElement; }
    return { cx, cy, topChain: chain, buttonIsOrContainsTop: b.contains(top) };
  });
  console.log('center:', info.cx, info.cy);
  console.log('topmost element chain:', info.topChain.join(' -> '));
  console.log('close button contains topmost:', info.buttonIsOrContainsTop);

  // trusted click via CDP at exact center
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: info.cx, y: info.cy, button: 'left', clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: info.cx, y: info.cy, button: 'left', clickCount: 1 });
  await page.waitForTimeout(800);
  console.log('after CDP trusted click, drawer count:', await page.locator('[data-testid="experiment-drawer"]').count());
  await browser.close();
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
