// Probe the exact Promise.all set the DataProvider uses.
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((p) => p.url().includes('file://')) || pages[0];
const out = await app.evaluate(async () => {
  const results = [];
  const paths = [
    'agents', 'providers', 'runs', 'runtimes', 'memory/scopes', 'memory/entries',
    'artifacts', 'boards', 'tools', 'research/briefs', 'sales/leads', 'schedules',
    'settings/gateway/credentials-status',
  ];
  for (const p of paths) {
    try {
      const r = await fetch(`http://localhost:4000/api/${p}`);
      const t = await r.text();
      results.push({ p, status: r.status, len: t.length, head: t.slice(0, 80) });
    } catch (e) {
      results.push({ p, err: String(e) });
    }
  }
  return results;
});
for (const r of out) console.log((r.status === 200 ? 'ok   ' : 'FAIL ') + JSON.stringify(r));
await browser.disconnect();
