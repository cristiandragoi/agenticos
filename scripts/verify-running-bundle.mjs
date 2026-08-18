// Verify which bundle the running Electron renderer actually loaded.
import p from 'puppeteer-core';
(async () => {
  const b = await p.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
  const pages = await b.pages();
  console.log('PAGES', pages.length);
  const pg = pages.find((x) => x.url().includes('index.html')) || pages[0];
  await new Promise((r) => setTimeout(r, 2500));
  const r = await pg.evaluate(() => {
    const s = document.querySelectorAll('script[src]');
    return Array.from(s).map((x) => x.src).join('\n');
  });
  console.log('SCRIPT_SRC', r);
  const title = await pg.title();
  console.log('TITLE', title);
  await b.disconnect();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
