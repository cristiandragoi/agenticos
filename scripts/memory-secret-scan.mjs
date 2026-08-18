// Secret scan: do any stored memory records contain raw credential-like values?
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const SERVER_NM = 'B:/AgenticOS/server/node_modules/';
const Database = require(path.join(SERVER_NM, 'better-sqlite3'));
const db = new Database('C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db', { readonly: true });
const SEAL = /(sk-[A-Za-z0-9]{16,}|api[_-]?key[=:]\s*\S{8,}|Bearer\s+[A-Za-z0-9._-]{16,}|Authorization[=:]\s*\S{12,}|[A-Z0-9_]{6,}_API_KEY[=:]\s*\S{8,})/i;
const rows = db.prepare("SELECT id, title, content, summary FROM memory_records").all();
let hits = 0;
for (const r of rows) {
  const blob = `${r.title || ''} ${r.content || ''} ${r.summary || ''}`;
  if (SEAL.test(blob)) { hits++; console.log('SECRET-HIT', r.id, blob.slice(0, 160)); }
}
console.log('scanned', rows.length, 'records; secret hits:', hits);
db.close();
