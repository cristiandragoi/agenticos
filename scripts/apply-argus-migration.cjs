/* Apply ARGUS migration 0022 DDL to a SQLite DB in a guarded, idempotent way.
 * Usage: node scripts/apply-argus-migration.cjs <dbPath>
 * Guarded: CREATE TABLE IF NOT EXISTS; ALTER TABLE only if column missing.
 */
const path = require('path');
const dbPath = process.argv[2] || 'B:/AgenticOS/server/data/agentic-os.db';
const Database = require(path.resolve('B:/AgenticOS/server/node_modules/better-sqlite3'));
const db = new Database(dbPath);

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
const cols = db.prepare('PRAGMA table_info(goals)').all().map(c => c.name);

const run = (sql) => { db.exec(sql); console.log('OK:', sql.split('\n')[0].slice(0, 80)); };

if (!tables.includes('argus_contracts')) run(`CREATE TABLE "argus_contracts" (
  "id" text PRIMARY KEY NOT NULL,
  "goal_id" text NOT NULL,
  "workspace_path" text NOT NULL,
  "title" text NOT NULL,
  "original_spec" text NOT NULL,
  "acceptance_criteria" text NOT NULL,
  "spec_hash" text NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);`);
else console.log('SKIP: argus_contracts exists');

if (!tables.includes('argus_verifications')) run(`CREATE TABLE "argus_verifications" (
  "id" text PRIMARY KEY NOT NULL,
  "contract_id" text NOT NULL,
  "goal_id" text NOT NULL,
  "attempt" integer DEFAULT 0 NOT NULL,
  "status" text NOT NULL,
  "evidence_level" text DEFAULT 'L0' NOT NULL,
  "verdict" text NOT NULL,
  "provider" text,
  "model" text,
  "created_at" text NOT NULL,
  "completed_at" text
);`);
else console.log('SKIP: argus_verifications exists');

if (!tables.includes('argus_defects')) run(`CREATE TABLE "argus_defects" (
  "id" text PRIMARY KEY NOT NULL,
  "verification_id" text NOT NULL,
  "contract_id" text NOT NULL,
  "goal_id" text NOT NULL,
  "severity" text DEFAULT 'major' NOT NULL,
  "description" text NOT NULL,
  "reproduction" text,
  "expected" text,
  "actual" text,
  "fix_suggestion" text,
  "status" text DEFAULT 'open' NOT NULL,
  "correction_goal_id" text,
  "created_at" text NOT NULL,
  "resolved_at" text
);`);
else console.log('SKIP: argus_defects exists');

if (!tables.includes('argus_corrections')) run(`CREATE TABLE "argus_corrections" (
  "id" text PRIMARY KEY NOT NULL,
  "contract_id" text NOT NULL,
  "defect_id" text NOT NULL,
  "goal_id" text NOT NULL,
  "attempt" integer NOT NULL,
  "status" text DEFAULT 'dispatched' NOT NULL,
  "created_at" text NOT NULL,
  "completed_at" text
);`);
else console.log('SKIP: argus_corrections exists');

// Indexes (IF NOT EXISTS is supported in modern SQLite)
for (const idx of [
  'CREATE INDEX IF NOT EXISTS "uq_argus_contracts_goal" ON "argus_contracts" ("goal_id");',
  'CREATE INDEX IF NOT EXISTS "idx_argus_verifications_contract" ON "argus_verifications" ("contract_id");',
  'CREATE INDEX IF NOT EXISTS "idx_argus_defects_status" ON "argus_defects" ("status");',
  'CREATE INDEX IF NOT EXISTS "idx_argus_corrections_contract" ON "argus_corrections" ("contract_id", "attempt");',
]) run(idx);

if (!cols.includes('verification_state')) run(`ALTER TABLE "goals" ADD "verification_state" text DEFAULT 'none' NOT NULL;`);
else console.log('SKIP: goals.verification_state exists');
if (!cols.includes('contract_id')) run(`ALTER TABLE "goals" ADD "contract_id" text;`);
else console.log('SKIP: goals.contract_id exists');

db.close();
console.log('DONE');
