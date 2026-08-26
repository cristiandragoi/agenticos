// Reconcile drizzle migration hashes: which migration files are recorded as applied?
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const dbPath = path.resolve(__dirname, 'data/agentic-os.db');
const drizzleDir = path.resolve(__dirname, 'drizzle');

const db = new Database(dbPath, { readonly: true });
let appliedHashes = [];
try {
  appliedHashes = db.prepare('SELECT hash, created_at FROM __drizzle_migrations').all().map(r => r.hash);
} catch (e) { console.log('NO __drizzle_migrations:', e.message); }
db.close();

const journal = JSON.parse(fs.readFileSync(path.join(drizzleDir, 'meta', '_journal.json'), 'utf-8'));
console.log('Journal entries:', journal.entries.length);

const hashOf = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

console.log('\n=== Migration files vs applied hashes (last 6 by idx) ===');
const entries = journal.entries.slice(-6);
for (const e of entries) {
  const fname = e.tag + '.sql';
  const fp = path.join(drizzleDir, fname);
  if (!fs.existsSync(fp)) { console.log(`${e.idx} ${e.tag}: FILE MISSING`); continue; }
  const buf = fs.readFileSync(fp);
  const h = hashOf(buf);
  const applied = appliedHashes.includes(h);
  console.log(`${e.idx} ${e.tag}: hash=${h.slice(0,12)}… applied=${applied}`);
}

// Also check whether revenue_metrics appears anywhere as a migration file
console.log('\n=== 0024 file present? ===');
const f24 = path.join(drizzleDir, '0024_revenue_metrics.sql');
console.log(fs.existsSync(f24) ? 'YES exists' : 'NO (missing)');
