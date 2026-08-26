/* RO1 deploy: apply 0021_add_revenue_metrics to canonical DB (guarded, idempotent, transactional).
 * Root cause: drizzle migrator only applies migrations with when > max(__drizzle_migrations.created_at);
 * 0021's when (1787131551375) < 0022_argus row (1787141600473) so it can never auto-apply.
 * Precedent: scripts/apply-argus-migration.cjs (same guarded-DDL approach). DB backed up pre-mutation.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const RES = 'C:/Users/Cris/Desktop/desktop/Agentic_OS/Agentic OS/resources';
const Database = require(path.join(RES, 'server/node_modules/better-sqlite3'));
const DB_PATH = 'C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db';

const sqlFile = path.join(RES, 'server/drizzle/0021_add_revenue_metrics.sql');
const fileHash = crypto.createHash('sha256').update(fs.readFileSync(sqlFile)).digest('hex');
const WHEN = 1787131551375; // journal `when` for 0021 (matches repo + packaged journal)

const db = new Database(DB_PATH, { timeout: 15000 });
db.pragma('foreign_keys = ON');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);

if (tables.includes('revenue_metrics')) {
  console.log('SKIP: revenue_metrics already exists (idempotent guard)');
} else {
  const tx = db.transaction(() => {
    db.exec(`CREATE TABLE \`revenue_metrics\` (
\t\`id\` text PRIMARY KEY NOT NULL,
\t\`opportunity_id\` text NOT NULL,
\t\`expected_yield\` real,
\t\`actual_yield\` real,
\t\`clicks\` integer,
\t\`conversions\` integer,
\t\`revenue\` real,
\t\`status\` text DEFAULT 'measuring' NOT NULL,
\t\`measured_at\` text,
\t\`created_at\` text NOT NULL,
\tFOREIGN KEY (\`opportunity_id\`) REFERENCES \`revenue_opportunities\`(\`id\`) ON UPDATE no action ON DELETE cascade
);`);
    db.exec(`CREATE INDEX \`idx_rev_metrics_opportunity\` ON \`revenue_metrics\` (\`opportunity_id\`);`);
    db.prepare('INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES (?, ?)').run(fileHash, WHEN);
  });
  tx();
  console.log('APPLIED: revenue_metrics table + index + migration record row');
}
// verify
const cnt = db.prepare('SELECT COUNT(*) c FROM revenue_metrics').get();
console.log('revenue_metrics rows:', cnt.c);
console.log('migration record present:', db.prepare('SELECT COUNT(*) c FROM __drizzle_migrations WHERE hash = ?').get(fileHash).c === 1);
console.log('total migration rows:', db.prepare('SELECT COUNT(*) c FROM __drizzle_migrations').get().c);
console.log('integrity_check:', db.pragma('integrity_check', { simple: true }));
db.close();
