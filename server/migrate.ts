import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';

const userDataPath = process.env.USER_DATA_PATH || path.join(os.homedir(), '.agentic-os');
const dbPath = path.join(userDataPath, 'agentic-os.db');

const sqlite = new Database(dbPath);
const db = drizzle(sqlite);

try {
  migrate(db, { migrationsFolder: './drizzle' });
  console.log('Migration completed successfully.');
} catch (err) {
  console.error('Migration failed:', err);
}
