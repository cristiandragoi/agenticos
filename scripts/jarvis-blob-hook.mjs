// Inject a fetch hook into the running app that captures every /voice/transcribe blob.
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((p) => p.url().includes('file://')) || pages[0];
await app.evaluate(() => {
  if (window.__voiceBlobCapture) return;
  window.__voiceBlobCapture = [];
  const origFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    try {
      if (typeof input === 'string' && input.includes('/voice/transcribe') && init && init.body instanceof FormData) {
        const fd = init.body;
        const audio = fd.get('audio');
        const meta = { at: Date.now(), size: audio ? audio.size : 0, type: audio ? audio.type : null };
        if (audio && audio.size > 0) {
          const buf = await audio.arrayBuffer();
          meta.b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
        }
        window.__voiceBlobCapture.push(meta);
        console.error('[BlobCap] captured blob ' + meta.size + 'B type=' + meta.type);
      }
    } catch (e) {
      console.error('[BlobCap] hook error', String(e));
    }
    return origFetch(input, init);
  };
  console.error('[BlobCap] fetch hook installed');
});
await browser.disconnect();
console.log('HOOK_INSTALLED');
