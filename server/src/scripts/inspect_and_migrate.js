import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoServerRoot = path.resolve(__dirname, '../..');
const defaultDataDir = path.join(repoServerRoot, 'data');
const dbPath = process.env.AGENT_TEAMS_DB_PATH || path.join(defaultDataDir, 'agentic-os.db');
const migrationsFolder = path.join(repoServerRoot, 'drizzle');

console.log({
  scriptDirectory: __dirname,
  repoServerRoot,
  dbPath,
  migrationsFolder
});

if (!fs.existsSync(migrationsFolder)) {
  throw new Error(`Migrations folder not found: ${migrationsFolder}`);
}

if (!fs.existsSync(path.dirname(dbPath))) {
  throw new Error(`Database directory not found: ${path.dirname(dbPath)}`);
}

// Create backup
const backupPath = dbPath + '.backup-' + Date.now();
if (fs.existsSync(dbPath)) {
  fs.copyFileSync(dbPath, backupPath);
  console.log("Backup created at:", backupPath);
} else {
  console.log("Database file does not exist yet.");
}

const sqlite = new Database(dbPath);

console.log("\nBefore migration PRAGMA:");
const before = sqlite.prepare("PRAGMA table_info(agent_provider_assignments)").all();
console.log(JSON.stringify(before, null, 2));

// Do not apply migrations yet
process.exit(0);
