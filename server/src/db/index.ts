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
