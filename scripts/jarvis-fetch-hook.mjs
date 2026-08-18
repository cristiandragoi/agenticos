// Inject a fetch hook into the running renderer that records every
// /voice/transcribe request: URL, audio blob size/type, response status,
// response body. Stored on window.__vtFetch for later retrieval.
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const page = pages.find((p) => p.url().startsWith('file:')) || pages[0];
await page.evaluate(() => {
  window.__vtFetch = [];
  window.__vtFetchHook = true;
  const origFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const url = String(args[0] || '');
    const init = args[1] || {};
    let blobInfo = null;
    if (init.body instanceof FormData) {
      for (const entry of init.body.entries()) {
        const v = entry[1];
        if (v instanceof Blob) blobInfo = { field: entry[0], size: v.size, type: v.type };
      }
    }
    if (url.includes('/voice/transcribe')) {
      const t0 = performance.now();
      try {
        const res = await origFetch(...args);
        const text = await res.clone().text().catch(() => '');
        window.__vtFetch.push({
          t: Date.now(), url, method: init.method, blobInfo,
          status: res.status, body: text.slice(0, 500),
          ms: Math.round(performance.now() - t0),
        });
      } catch (e) {
        window.__vtFetch.push({ t: Date.now(), url, blobInfo, error: String((e && e.message) || e) });
      }
    }
    return origFetch(...args);
  };
});
console.log('FETCH_HOOK_INSTALLED');
await browser.disconnect();
