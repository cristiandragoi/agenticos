// LCP benchmark harness (Playwright + CDP CPU/network throttling).
// Usage: node .lcp-bench/measure.cjs <url> <runs> <outJson>
const { chromium } = require('playwright');

const url = process.argv[2] || 'http://127.0.0.1:8099/';
const runs = Number(process.argv[3] || 3);
const out = process.argv[4] || null;

const INIT = `
window.__bench = { lcp: 0, lcpEl: null, fcp: 0, longTasks: 0, longTaskMs: 0, appMount: null, appContentAt: null, shellGone: null, shellPainted: null, shellAtLoad: null };
window.__bench.shellAtLoad = null;
try {
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) { if (e.name === 'boot-shell-painted') window.__bench.shellPainted = e.startTime; if (e.name === 'boot-shell-removed') window.__bench.shellGone = e.startTime; }
  }).observe({ type: 'mark', buffered: true });
} catch (e) {}
try {
  const watch = () => {
    const root = document.getElementById('root');
    if (!root) { requestAnimationFrame(watch); return; }
    window.__bench.shellAtLoad = !!document.getElementById('boot-shell');
    new MutationObserver(() => {
      const appNode = document.querySelector('.app-shell, #app-shell, [data-app-shell]');
      const shell = document.getElementById('boot-shell');
      if (appNode && window.__bench.appMount === null && performance.now) window.__bench.appMount = performance.now();
      if (!shell && window.__bench.shellGone === null && performance.now) window.__bench.shellGone = performance.now();
      // "real app content" = non-shell node inserted into #root (works with or
      // without a boot shell, so before/after runs stay comparable)
      if (window.__bench.appContentAt === null) {
        const nodes = [].slice.call(root.children).filter(function (n) { return n.id !== 'boot-shell'; });
        if (nodes.length && (root.innerText || '').trim().length > 20) window.__bench.appContentAt = performance.now();
      }
    }).observe(root, { childList: true, subtree: true });
  };
  watch();
} catch (e) {}
try {
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      if (e.startTime > window.__bench.lcp) {
        window.__bench.lcp = e.startTime;
        window.__bench.lcpEl = (e.element && (e.element.tagName + (e.element.id ? '#' + e.element.id : '') + (e.element.className && typeof e.element.className === 'string' ? '.' + e.element.className.split(' ').slice(0,2).join('.') : ''))) || e.url || 'n/a';
        window.__bench.lcpSize = e.size;
      }
    }
  }).observe({ type: 'largest-contentful-paint', buffered: true });
} catch (e) { window.__bench.lcpErr = String(e); }
try {
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) if (e.name === 'first-contentful-paint') window.__bench.fcp = e.startTime;
  }).observe({ type: 'paint', buffered: true });
} catch (e) {}
try {
  new PerformanceObserver((list) => { for (const e of list.getEntries()) { window.__bench.longTasks++; window.__bench.longTaskMs += e.duration; } })
    .observe({ type: 'longtask', buffered: true });
} catch (e) {}
`;

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const results = [];
  for (let i = 0; i < runs; i++) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await page.addInitScript(INIT);
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false, latency: 40, downloadThroughput: (10 * 1024 * 1024) / 8, uploadThroughput: (3 * 1024 * 1024) / 8,
    });
    const t0 = Date.now();
    const shot = (tag) => process.env.BENCH_SHOT ? page.screenshot({ path: `${process.env.BENCH_SHOT}-${i}-${tag}.png` }).catch(() => {}) : Promise.resolve();
    try {
      await page.goto(url, { waitUntil: 'commit', timeout: 60000 });
      await page.waitForTimeout(150);
      await shot('150ms');
      await page.waitForTimeout(350);
      await shot('500ms');
      await page.waitForTimeout(500);
      await shot('1000ms');
      await page.waitForLoadState('load').catch(() => {});
      await page.waitForTimeout(4000);
      await shot('settled');
    } catch (e) {
      console.error('nav error:', e.message);
    }
    const wall = Date.now() - t0;
    const data = await page.evaluate(() => {
      const res = performance.getEntriesByType('resource');
      let bytes = 0;
      for (const r of res) bytes += r.transferSize || 0;
      const nav = performance.getEntriesByType('navigation')[0] || {};
      const root = document.getElementById('root');
      return {
        ...window.__bench,
        resources: res.length,
        bytes,
        domContentLoaded: nav.domContentLoadedEventEnd,
        loadEnd: nav.loadEventEnd,
        rootChildren: root ? root.children.length : -1,
        rootText: root ? (root.innerText || '').trim().slice(0, 80) : '',
        cssSheets: document.styleSheets.length,
      };
    });
    results.push({ wall, ...data });
    await context.close();
  }
  await browser.close();

  const nums = (k) => results.map((r) => r[k]).filter((v) => typeof v === 'number' && isFinite(v)).sort((a, b) => a - b);
  const med = (k) => { const a = nums(k); return a.length ? a[Math.floor(a.length / 2)] : null; };
  const summary = {
    url, runs,
    lcp_median_ms: med('lcp'), lcp_all: results.map((r) => Math.round(r.lcp)),
    fcp_median_ms: med('fcp'), domContentLoaded_median_ms: med('domContentLoaded'), load_median_ms: med('loadEnd'),
    longTaskMs_median: med('longTaskMs'), transferBytes_median: med('bytes'), resources_median: med('resources'),
    lcpElement: results[0] && results[0].lcpEl, rootTextLen: results[0] && results[0].rootText,
    perRun: results,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (out) require('fs').writeFileSync(out, JSON.stringify(summary, null, 2));
})();
