import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoServerRoot = path.resolve(__dirname, '..', '..');

// ── 1. Determine Canonical Data Directory and Database Path ──────────────────
const isTestEnv = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';

let canonicalDataDir: string;
if (process.env.AGENTICOS_DATA_DIR) {
  canonicalDataDir = path.resolve(process.env.AGENTICOS_DATA_DIR);
} else if (isTestEnv && !process.env.AGENT_TEAMS_DB_PATH) {
  // Isolate tests into a unique temporary directory
  canonicalDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agenticos-test-db-'));
} else {
  const roamingDataDir = process.env.APPDATA
    ? path.join(process.env.APPDATA, 'agenticos', 'data')
    : path.join(os.homedir(), 'AppData', 'Roaming', 'agenticos', 'data');
  if (repoServerRoot.toLowerCase().includes('local\\programs\\agenticos') || repoServerRoot.toLowerCase().includes('local/programs/agenticos') || fs.existsSync(roamingDataDir)) {
    canonicalDataDir = roamingDataDir;
  } else {
    canonicalDataDir = path.join(repoServerRoot, 'data');
  }
}

const canonicalDbPath = process.env.AGENT_TEAMS_DB_PATH
  ? path.resolve(process.env.AGENT_TEAMS_DB_PATH)
  : path.join(canonicalDataDir, 'agentic-os.db');

// Safety Guard: prevent tests from accessing live production data.
// Covers BOTH known production paths:
//   - D:\AgenticOS\server\data\agentic-os.db  (dev/packaged server data)
//   - C:\Users\...\AppData\Roaming\agenticos\data\agentic-os.db  (canonical user data)
//   - C:\Users\...\AppData\Local\Programs\AgenticOS  (legacy packaged install)
const PROTECTED_PROD_PATH_FRAGMENTS = [
  'appdata\\roaming\\agenticos',
  'appdata\\local\\programs\\agenticos',
  'appdata/roaming/agenticos',
  'appdata/local/programs/agenticos',
];

if (isTestEnv && !process.env.ALLOW_PROD_DB_IN_TEST) {
  const norm = canonicalDbPath.toLowerCase().replace(/\//g, '\\');
  const prodServerData = path.join(repoServerRoot, 'data', 'agentic-os.db').toLowerCase();
  const isServerDataPath = norm === prodServerData.toLowerCase().replace(/\//g, '\\');
  const isProdFragment = PROTECTED_PROD_PATH_FRAGMENTS.some(f => norm.includes(f));

  if (isServerDataPath || isProdFragment) {
    throw new Error(
      `[CRITICAL SECURITY GUARD] Automated test attempted to open production database: ${canonicalDbPath}\n` +
      `Set AGENTICOS_DATA_DIR to an explicit temp directory, or ensure NODE_ENV=test before module load.`
    );
  }

  // Additional check: in test mode without explicit AGENTICOS_DATA_DIR override,
  // the path must reside inside the OS temp directory.
  if (!process.env.AGENTICOS_DATA_DIR && !process.env.AGENT_TEAMS_DB_PATH) {
    const tmpBase = os.tmpdir().toLowerCase().replace(/\//g, '\\');
    if (!norm.startsWith(tmpBase)) {
      throw new Error(
        `[CRITICAL SECURITY GUARD] Test database is not in temp directory.\n` +
        `Resolved path: ${canonicalDbPath}\n` +
        `Expected prefix: ${os.tmpdir()}\n` +
        `This guard prevents tests from writing to development or production databases.`
      );
    }
  }
}

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

// ── 5. Safe idempotent column additions for legacy tables ──────────────────
try {
  rawDb.exec('ALTER TABLE provider_credentials ADD COLUMN api_key TEXT;');
} catch {}

// revenue_human_gates column convergence: schema.ts declares more columns than
// migration 0023 created. Converge HERE (every DB open — fresh test temp DBs
// run migrate() and land on the legacy shape, dev DBs predate the columns) so
// any insert against the full schema succeeds. Mirrors the projectsStore ALTERs,
// but at the universal bootstrap so test-only DB paths are covered too.
try {
  const gatePragma = rawDb.prepare('PRAGMA table_info(revenue_human_gates)').all() as Array<{ name: string }>;
  if (gatePragma.length > 0) {
    const gateCols = new Set(gatePragma.map((c) => c.name));
    const GATE_MISSING_COLUMNS = [
      ['project_id', 'TEXT'],
      ['task_id', 'TEXT'],
      ['platform', 'TEXT'],
      ['user_action', 'TEXT'],
      ['gate_url', 'TEXT'],
      ['expires_at', 'TEXT'],
      ['notified_conversation', 'TEXT'],
      ['evidence', 'TEXT'],
    ] as const;
    for (const [col, type] of GATE_MISSING_COLUMNS) {
      if (!gateCols.has(col)) rawDb.exec(`ALTER TABLE revenue_human_gates ADD COLUMN ${col} ${type}`);
    }
  }
} catch { /* table may not exist yet — best effort */ }

// ── 6. Exported path and isolation assertion for tests ───────────────────────
/** The exact absolute SQLite path this process has opened. Read by tests to
 *  prove isolation before any destructive fixture setup. */
export const resolvedDbPath = canonicalDbPath;

/** Two protected production database absolute paths — tests must never touch either. */
export const PRODUCTION_DB_PATHS: ReadonlyArray<string> = [
  path.join(repoServerRoot, 'data', 'agentic-os.db'),
  path.join(os.homedir(), 'AppData', 'Roaming', 'agenticos', 'data', 'agentic-os.db'),
];

/**
 * Hard guard for use in test beforeAll() blocks.
 * Throws with a clear message if the resolved database path is not inside
 * the OS temporary directory, or if it matches either production path.
 * Call this before any DELETE / INSERT fixture setup.
 */
export function assertTestDatabaseIsolation(): void {
  const norm = canonicalDbPath.toLowerCase().replace(/\//g, '\\');
  const tmpBase = os.tmpdir().toLowerCase().replace(/\//g, '\\');

  for (const prodPath of PRODUCTION_DB_PATHS) {
    const prodNorm = prodPath.toLowerCase().replace(/\//g, '\\');
    if (norm === prodNorm) {
      throw new Error(
        `[assertTestDatabaseIsolation] BLOCKED: test is running against production database:\n  ${canonicalDbPath}\n` +
        `Ensure NODE_ENV=test is set before any module import, or set AGENTICOS_DATA_DIR to a temp path.`
      );
    }
  }

  if (!norm.startsWith(tmpBase)) {
    throw new Error(
      `[assertTestDatabaseIsolation] BLOCKED: database is not in temp directory.\n` +
      `  Resolved: ${canonicalDbPath}\n` +
      `  Expected prefix: ${os.tmpdir()}\n` +
      `Tests must only write to isolated temporary databases.`
    );
  }
}
