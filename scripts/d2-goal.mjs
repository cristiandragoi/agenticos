// Inspect the CodeX goal record + its failure.
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const app = pages.find((p) => p.url().includes('file://')) || pages[0];
const out = await app.evaluate(async () => {
  const base = 'http://localhost:4000/api';
  const gid = 'goal-f2179d6f-';
  const results = {};
  for (const path of [`/codex/goals/${gid}`, `/goals/${gid}`, `/codex/goals?limit=5`]) {
    try {
      const r = await fetch(base + path);
      const t = await r.text();
      results[path] = { status: r.status, body: t.slice(0, 600) };
    } catch (e) { results[path] = { err: String(e) }; }
  }
  return results;
});
console.log(JSON.stringify(out, null, 1));
await browser.disconnect();
