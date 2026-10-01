/**
 * shopify-credential-probe.mjs — read-only probe of credential stores + the actual
 * myshopify mention context in the live runtime DB. Values are never printed for
 * secret-like columns; only row presence and non-secret identifiers.
 * Usage: node scripts/shopify-credential-probe.mjs
 */
import Database from 'better-sqlite3';

const LIVE = 'C:/Users/cd-pr/AppData/Roaming/agenticos/data/agentic-os.db';
const db = new Database(LIVE, { readonly: true, fileMustExist: true });
const out = {};

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
out.tablesMatchingShopifyish = tables.filter((t) => /shop|store|channel|credential|secret|integrat|connect|commerce/i.test(t));

const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
const SECRETISH = /secret|token|password|key|value|credential|client/i;

for (const t of ['provider_credentials', 'system_secrets']) {
  if (!tables.includes(t)) continue;
  const c = cols(t);
  const textCols = c.filter((n) => !SECRETISH.test(n));
  const rows = db.prepare(`SELECT ${textCols.map((n) => `"${n}"`).join(', ')} FROM ${t}`).all();
  out[t] = {
    columns: c,
    rowCount: rows.length,
    rowsContainingShopify: rows
      .map((r) => {
        const s = JSON.stringify(r);
        return /shopify/i.test(s) ? s.slice(0, 300) : null;
      })
      .filter(Boolean),
  };
}

// what text actually sits around "myshopify" (the only host hit found)
const er = db.prepare('PRAGMA table_info(execution_results)').all().map((c) => c.name);
out.executionResultsColumns = er;
const myRows = db
  .prepare("SELECT id FROM execution_results WHERE structured_output LIKE '%myshopify%' LIMIT 3")
  .all();
out.myshopifyRows = myRows.map((r) => {
  const full = db.prepare('SELECT structured_output s FROM execution_results WHERE id = ?').get(r.id).s || '';
  const i = full.indexOf('myshopify');
  return { id: r.id, context: full.slice(Math.max(0, i - 160), i + 160), length: full.length };
});

out.channelLikeTables = tables.filter((t) => /channel/i.test(t));
console.log(JSON.stringify(out, null, 2));
db.close();
