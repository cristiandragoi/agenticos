// Read-only: provider credentials + circuit breakers from the deployed DB
// (credential KEY NAMES only, never values).
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.join(__dirname, '..', 'server');
const require = createRequire(path.join(serverDir, 'package.json'));
const Database = require('better-sqlite3');
const db = new Database(process.argv[2], { readonly: true });
for (const t of ['provider_credentials', 'provider_circuit_breakers']) {
  const cols = db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
  const rows = db.prepare(`SELECT * FROM ${t}`).all();
  console.log(`\n=== ${t} (${rows.length} rows) cols=${cols.join(',')} ===`);
  for (const r of rows) {
    const redacted = {};
    for (const [k, v] of Object.entries(r)) {
      redacted[k] = /key|secret|token|credential|api/i.test(k) && typeof v === 'string' && v.length > 8 ? `<redacted:${v.length} chars>` : v;
    }
    console.log(JSON.stringify(redacted));
  }
}
db.close();
