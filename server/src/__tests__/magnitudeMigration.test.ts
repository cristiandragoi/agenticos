import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

/**
 * magnitudeMigration.test.ts — regression for the live-deploy migration bug:
 * a legacy magnitude_runs table (created WITHOUT project_id) must gain the
 * new columns when the new service module initializes. Previously the
 * CREATE INDEX ... ON magnitude_runs(project_id) inside the same exec block
 * threw on legacy tables, silently skipping the ALTERs.
 *
 * Strategy: point AGENT_TEAMS_DB_PATH at a temp DB that already contains the
 * LEGACY schema, reset the module graph, then import the service module so
 * its initMagnitudeTables() runs against it, and assert the columns exist.
 */
function makeLegacyDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mag-mig-'));
  const dbPath = path.join(dir, 'agentic-os.db');
  const Database = createRequire(import.meta.url)('../../node_modules/better-sqlite3');
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE magnitude_runs (
      id TEXT PRIMARY KEY,
      goal TEXT NOT NULL,
      requested_url TEXT NOT NULL,
      action_type TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      duration_ms INTEGER,
      result TEXT,
      error TEXT,
      approval TEXT,
      conversation_id TEXT
    );
    CREATE TABLE magnitude_events (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      timestamp TEXT NOT NULL,
      event_type TEXT NOT NULL,
      message TEXT NOT NULL,
      details TEXT,
      FOREIGN KEY (run_id) REFERENCES magnitude_runs(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_magnitude_events_run ON magnitude_events(run_id, sequence);
  `);
  db.close();
  return dbPath;
}

describe('Magnitude legacy-table migration', () => {
  const originalDbPath = process.env.AGENT_TEAMS_DB_PATH;
  const originalDataDir = process.env.AGENTICOS_DATA_DIR;
  beforeEach(() => {
    vi.resetModules();
  });

  it('adds project provenance columns to a pre-existing legacy table', async () => {
    const dbPath = makeLegacyDb();
    process.env.AGENT_TEAMS_DB_PATH = dbPath;
    process.env.AGENTICOS_DATA_DIR = path.dirname(dbPath);

    const { magnitudeService } = await import('../domains/magnitude/service.js');

    const Database = createRequire(import.meta.url)('../../node_modules/better-sqlite3');
    const db = new Database(dbPath, { readonly: true });
    const cols = db.prepare('PRAGMA table_info(magnitude_runs)').all().map((c: any) => c.name);
    db.close();

    expect(cols).toContain('project_id');
    expect(cols).toContain('project_task_id');
    expect(cols).toContain('execution_run_id');
    expect(cols).toContain('schedule_execution_id');

    // The service must be able to create a run with provenance on the migrated DB.
    const run = magnitudeService.createRun('inspect https://example.com', 'inspect', undefined, { projectId: 'proj-MIG', projectTaskId: 'task-MIG' });
    expect(run.projectId).toBe('proj-MIG');
    const fetched = magnitudeService.getRun(run.id);
    expect(fetched?.projectId).toBe('proj-MIG');
  });

  it('is idempotent on an already-migrated table', async () => {
    const dbPath = makeLegacyDb();
    process.env.AGENT_TEAMS_DB_PATH = dbPath;
    process.env.AGENTICOS_DATA_DIR = path.dirname(dbPath);

    await import('../domains/magnitude/service.js');
    // Second import (fresh module graph) must not throw and must keep columns.
    vi.resetModules();
    await import('../domains/magnitude/service.js');

    const Database = createRequire(import.meta.url)('../../node_modules/better-sqlite3');
    const db = new Database(dbPath, { readonly: true });
    const cols = db.prepare('PRAGMA table_info(magnitude_runs)').all().map((c: any) => c.name);
    db.close();
    expect(cols).toContain('project_id');
  });
});
