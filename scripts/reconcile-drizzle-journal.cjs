const path = require('path');
const Database = require(path.resolve(__dirname, '../server/node_modules/better-sqlite3'));
const fs = require('fs');
const crypto = require('crypto');

const dbPath = path.resolve(__dirname, '../server/data/agentic-os.db');
const drizzleDir = path.resolve(__dirname, '../server/drizzle');
const journal = JSON.parse(fs.readFileSync(path.join(drizzleDir, 'meta', '_journal.json'), 'utf-8'));

const db = new Database(dbPath);
const appliedRows = db.prepare('SELECT hash FROM __drizzle_migrations').all();
const appliedHashes = new Set(appliedRows.map(r => r.hash));

const hashOf = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

const insertStmt = db.prepare('INSERT INTO __drizzle_migrations (id, hash, created_at) VALUES (?, ?, ?)');

let inserted = 0;
for (const entry of journal.entries) {
  const sqlFile = path.join(drizzleDir, `${entry.tag}.sql`);
  if (!fs.existsSync(sqlFile)) {
    console.warn(`File missing for tag: ${entry.tag}`);
    continue;
  }
  const content = fs.readFileSync(sqlFile);
  const hash = hashOf(content);
  if (!appliedHashes.has(hash)) {
    insertStmt.run(null, hash, entry.when);
    appliedHashes.add(hash);
    console.log(`Reconciled migration [${entry.idx}] ${entry.tag} (hash: ${hash.slice(0, 16)}...)`);
    inserted++;
  }
}

db.close();
console.log(`\nReconciliation complete: inserted ${inserted} missing migration records into __drizzle_migrations.`);
