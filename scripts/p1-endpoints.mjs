// Probe the registry endpoints from the page context; find failures.
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((p) => p.url().includes('file://')) || pages[0];
const out = await app.evaluate(async () => {
  const paths = [
    'agents', 'providers', 'runs', 'runtimes', 'memory/scopes', 'memory/entries',
    'artifacts', 'boards', 'tools', 'research/briefs', 'sales/leads', 'schedules',
    'background-tasks/summary', 'background-tasks/approvals', 'jarvis/runtime-state',
    'jarvis/live-events?limit=12', 'hermes-api/runs', 'hermes-api/status', 'health',
  ];
  const results = [];
  for (const p of paths) {
    try {
      const r = await fetch(`http://localhost:4000/api/${p}`);
      const t = await r.text();
      results.push({ p, status: r.status, len: t.length, head: t.slice(0, 60) });
    } catch (e) {
      results.push({ p, err: String(e) });
    }
  }
  return results;
});
for (const r of out) {
  if (r.status !== 200) console.log('FAIL ' + JSON.stringify(r));
  else console.log('ok   ' + r.p + ' len=' + r.len);
}
await browser.disconnect();
