// Early-state assertion: the shell must exist in the very first frames,
// before the bundled CSS/JS land.
const { chromium } = require('playwright');
(async () => {
  const url = process.argv[2];
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const cdp = await (await page.context().newCDPSession(page));
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 40, downloadThroughput: (10 * 1024 * 1024) / 8, uploadThroughput: 1024 * 1024 / 8 });
  const t = Date.now();
  await page.goto(url, { waitUntil: 'commit' });
  const samples = [];
  for (const ms of [120, 300, 600, 1200]) {
    await page.waitForTimeout(Math.max(0, ms - (Date.now() - t)));
    samples.push(await page.evaluate(() => {
      const s = document.getElementById('boot-shell');
      const r = s && s.getBoundingClientRect();
      return {
        t: Math.round(performance.now()),
        shell: !!s,
        shellBox: r ? [r.width, r.height].map(Math.round) : null,
        htmlBg: getComputedStyle(document.documentElement).backgroundColor,
        cssSheets: document.styleSheets.length,
        appNodes: document.querySelectorAll('#root > *').length,
      };
    }));
  }
  await page.screenshot({ path: '.lcp-bench/verify-early-600ms.png' });
  console.log(JSON.stringify({ url, samples }, null, 2));
  await browser.close();
})();
