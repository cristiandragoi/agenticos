// Focused artifact verification for the staged concept (no framework needed).
// Run: node tests/verify.mjs   → prints PASS/FAIL, exit code 0/1.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checks = [];
const read = (p) => {
  try { return fs.readFileSync(path.join(root, p), 'utf8'); } catch { return null; }
};

const requiredFiles = ['index.html', 'src/main.tsx', 'src/App.tsx', 'src/content.ts', 'src/styles.css'];
for (const f of requiredFiles) checks.push([`file exists: ${f}`, read(f) !== null]);

const html = read('index.html') || '';
checks.push(['index.html has lang attribute', /<html[^>]*lang=/.test(html)]);
checks.push(['index.html has viewport meta', /name="viewport"/.test(html)]);
checks.push(['index.html has root div', /id="root"/.test(html)]);
checks.push(['index.html uses placeholder title marker', html.includes('[PLACEHOLDER')]);

const app = read('src/App.tsx') || '';
const requiredIds = ['hero', 'services', 'locations', 'trust', 'contact', 'site-footer'];
for (const id of requiredIds) checks.push([`App.tsx has section id ${id}`, new RegExp(`id="${id}"`).test(app)]);

// No fabricated claims: no prices, rankings, revenue, or fake reviews in content.
const content = (read('src/content.ts') || '') + '\n' + app;
const fabricated = [
  [/€\s?\d{2,}/g, 'price'],
  [/\brank(ed)?\s*#?\d/gi, 'ranking'],
  [/\brevenue\b/gi, 'revenue'],
  [/\b#1\b/g, 'number-one claim'],
];
for (const [re, label] of fabricated) {
  const hits = (content.match(re) || []).filter((h) => !h.includes('PLACEHOLDER'));
  checks.push([`no fabricated ${label} claims`, hits.length === 0]);
}

let failed = 0;
for (const [name, ok] of checks) {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name);
  if (!ok) failed++;
}
console.log(failed === 0 ? `VERIFY OK (${checks.length} checks)` : `VERIFY FAILED (${failed}/${checks.length})`);
process.exit(failed === 0 ? 0 : 1);
