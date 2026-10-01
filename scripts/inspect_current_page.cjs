const { chromium } = require('playwright');

async function inspect() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const page = browser.contexts()[0].pages()[0];
  console.log('Current URL:', page.url());

  const buttons = await page.$$eval('button, [role="button"]', els => els.map(e => ({
    text: e.innerText.trim(),
    title: e.getAttribute('title'),
    ariaLabel: e.getAttribute('aria-label'),
    testid: e.getAttribute('data-testid'),
    className: e.className
  })));

  const matched = buttons.filter(b => {
    const s = `${b.text} ${b.title || ''} ${b.ariaLabel || ''} ${b.testid || ''}`.toLowerCase();
    return s.includes('mic') || s.includes('voice') || s.includes('talk') || s.includes('record');
  });

  console.log('Matched buttons:', JSON.stringify(matched, null, 2));
  await browser.close();
}

inspect().catch(console.error);
