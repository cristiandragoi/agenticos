import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import path from 'path';
import os from 'os';

// Determine the database path
// If running in production (spawned by Electron), it should provide USER_DATA_PATH.
// Otherwise, fallback to a local .data folder or os temp dir.
const userDataPath = process.env.USER_DATA_PATH || path.join(os.homedir(), '.agentic-os');
const dbPath = process.env.AGENT_TEAMS_DB_PATH || path.join(userDataPath, 'agentic-os.db');

// Ensure the directory exists
import fs from 'fs';
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
