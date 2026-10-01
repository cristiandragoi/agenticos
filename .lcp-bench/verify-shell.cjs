// Post-boot DOM assertion: the static shell must be gone once React commits.
const { chromium } = require('playwright');
(async () => {
  const url = process.argv[2];
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(url, { waitUntil: 'load' });
  const atLoad = await page.evaluate(() => !!document.getElementById('boot-shell'));
  await page.waitForTimeout(6000);
  const after = await page.evaluate(() => {
    const root = document.getElementById('root');
    return {
      shellPresent: !!document.getElementById('boot-shell'),
      rootChildCount: root.children.length,
      rootFirstTag: root.firstElementChild ? root.firstElementChild.tagName + '.' + (root.firstElementChild.className || '') : null,
      hangingTitles: document.querySelectorAll('#boot-shell, .boot-title').length,
      visibleText: (root.innerText || '').trim().slice(0, 120),
      bodyBg: getComputedStyle(document.body).backgroundColor,
    };
  });
  await page.screenshot({ path: process.argv[3] || '.lcp-bench/verify-settled.png' });
  console.log(JSON.stringify({ url, shellPresentInHtmlAtLoad: atLoad, ...after }, null, 2));
  await browser.close();
})();
