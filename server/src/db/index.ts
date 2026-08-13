import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoServerRoot = path.resolve(__dirname, '..', '..');
const defaultDataDir = path.join(repoServerRoot, 'data');
const dbPath = process.env.AGENT_TEAMS_DB_PATH || path.join(defaultDataDir, 'agentic-os.db');

// Ensure the directory exists
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// Initialize SQLite database
const sqlite = new Database(dbPath, { timeout: 15000 }); // Busy timeout
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON'); // Enforce FKs

// Export the drizzle instance
export const db = drizzle(sqlite, { schema });
export const sqliteDbPath = dbPath;
/** Raw connection for idempotent DDL (background task manager tables). */
export const rawDb = sqlite;

// Auto-migrate on every startup (idempotent — drizzle tracks applied
// migrations). Path is cwd-independent so the packaged desktop backend
// (spawned with cwd=resources/server) migrates the fresh DB exactly like
// the dev backend. Without this, a fresh packaged DB has no tables and the
// backend crashes at the first query (e.g. team_runs).
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
try {
  migrate(db, { migrationsFolder: path.resolve(repoServerRoot, 'drizzle') });
} catch (migrateErr) {
  // Never hide a real startup failure — surface it so the lifecycle can
  // report FAILED instead of a silent half-initialized backend.
  console.error('[db] migration failed:', migrateErr);
  throw migrateErr;
}
