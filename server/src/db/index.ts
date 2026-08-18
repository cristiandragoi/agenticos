import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoServerRoot = path.resolve(__dirname, '..', '..');

// ── 1. Determine Canonical Data Directory and Database Path ──────────────────
const defaultDataDir = path.join(repoServerRoot, 'data');
const canonicalDataDir = process.env.AGENTICOS_DATA_DIR
  ? path.resolve(process.env.AGENTICOS_DATA_DIR)
  : defaultDataDir;

const canonicalDbPath = process.env.AGENT_TEAMS_DB_PATH
  ? path.resolve(process.env.AGENT_TEAMS_DB_PATH)
  : path.join(canonicalDataDir, 'agentic-os.db');

// Ensure the target directory exists
const targetDir = path.dirname(canonicalDbPath);
if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
}

// ── 2. Safe Database Migration from Legacy Packaged Location ────────────────
export interface MigrationRecord {
  migrated: boolean;
  legacyPath: string | null;
  canonicalPath: string;
  backupPath: string | null;
  status: 'NO_MIGRATION_NEEDED' | 'SUCCESS' | 'FAILED';
  error?: string;
  timestamp: string;
}

let migrationRecord: MigrationRecord = {
  migrated: false,
  legacyPath: null,
  canonicalPath: canonicalDbPath,
  backupPath: null,
  status: 'NO_MIGRATION_NEEDED',
  timestamp: new Date().toISOString(),
};

function resolveLegacyDbPath(): string | null {
  if (process.env.AGENTICOS_LEGACY_DATA_DIR) {
    const legacyPath = path.join(process.env.AGENTICOS_LEGACY_DATA_DIR, 'agentic-os.db');
    if (fs.existsSync(legacyPath) && path.resolve(legacyPath) !== path.resolve(canonicalDbPath)) {
      return legacyPath;
    }
  }
  // Check if repoServerRoot is inside packaged resources
  const packagedResourcesLegacy = path.join(repoServerRoot, 'data', 'agentic-os.db');
  if (
    fs.existsSync(packagedResourcesLegacy) &&
    path.resolve(packagedResourcesLegacy) !== path.resolve(canonicalDbPath) &&
    (repoServerRoot.toLowerCase().includes('resources') || repoServerRoot.toLowerCase().includes('agentic os'))
  ) {
    return packagedResourcesLegacy;
  }
  return null;
}

function performSafeMigration() {
  const legacyPath = resolveLegacyDbPath();
  if (!legacyPath) return;

  // Never overwrite an existing populated canonical database
  if (fs.existsSync(canonicalDbPath)) {
    try {
      const stat = fs.statSync(canonicalDbPath);
      if (stat.size > 0) return; // Already populated
    } catch {}
  }

  // Verify legacy file has data
  try {
    const legacyStat = fs.statSync(legacyPath);
    if (legacyStat.size === 0) return;
  } catch {
    return;
  }

  console.log(`[db] Found legacy database at: ${legacyPath}`);
  console.log(`[db] Migrating to canonical location: ${canonicalDbPath}`);

  // Create backup in target data directory
  const backupDir = path.join(targetDir, 'backups');
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(
    backupDir,
    `agentic-os-legacy-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.db`
  );

  try {
    // 1. Copy legacy to backup
    fs.copyFileSync(legacyPath, backupPath);

    // 2. Copy legacy to canonical
    fs.copyFileSync(legacyPath, canonicalDbPath);

    // 3. Copy WAL / SHM files if present
    for (const ext of ['-wal', '-shm']) {
      const src = `${legacyPath}${ext}`;
      const dst = `${canonicalDbPath}${ext}`;
      if (fs.existsSync(src)) fs.copyFileSync(src, dst);
    }

    // 4. Verify integrity of migrated DB
    const testDb = new Database(canonicalDbPath, { readonly: true });
    const check = testDb.pragma('integrity_check') as any;
    testDb.close();

    const ok = Array.isArray(check) ? check[0]?.integrity_check === 'ok' : check === 'ok';
    if (!ok) {
      throw new Error(`Integrity check failed: ${JSON.stringify(check)}`);
    }

    migrationRecord = {
      migrated: true,
      legacyPath,
      canonicalPath: canonicalDbPath,
      backupPath,
      status: 'SUCCESS',
      timestamp: new Date().toISOString(),
    };
    console.log(`[db] Migration completed successfully. Backup at: ${backupPath}`);
  } catch (err: any) {
    console.error(`[db] Migration error: ${err.message}`, err);
    migrationRecord = {
      migrated: false,
      legacyPath,
      canonicalPath: canonicalDbPath,
      backupPath,
      status: 'FAILED',
      error: err.message,
      timestamp: new Date().toISOString(),
    };
  }
}

performSafeMigration();

// ── 3. Initialize SQLite Connection ─────────────────────────────────────────
const sqlite = new Database(canonicalDbPath, { timeout: 15000 });
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

export const db = drizzle(sqlite, { schema });
export const sqliteDbPath = canonicalDbPath;
export const rawDb = sqlite;
export { migrationRecord };

export type DbLocationType = 'canonical_userdata' | 'legacy_resources' | 'development';
export function getDbLocationType(): DbLocationType {
  const norm = canonicalDbPath.toLowerCase();
  if (norm.includes('appdata') || norm.includes('userdata') || norm.includes('.agentos')) {
    return 'canonical_userdata';
  }
  if (norm.includes('resources\\server') || norm.includes('resources/server')) {
    return 'legacy_resources';
  }
  return 'development';
}

// ── 4. Apply Schema Migrations ──────────────────────────────────────────────
try {
  migrate(db, { migrationsFolder: path.resolve(repoServerRoot, 'drizzle') });
} catch (migrateErr) {
  console.warn('[db] migration notice (tables may already exist):', (migrateErr as any)?.message || migrateErr);
}
