/**
 * cortexDb.ts — SQLite store for Cortex Suite shared engineering memory.
 *
 * Implements persistent engineering patterns, anti-patterns, corrections,
 * and test outcomes. Compatible with Artistsyn/cortex_suite schema.
 *
 * Concurrency & Safety:
 * - Uses WAL mode with busy_timeout (5000ms).
 * - Shared across Antigravity, Codex, Hermes, and Claude Code.
 * - Non-blocking: failures degrade gracefully without halting AgenticOS.
 */

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../../utils/logger.js';

export interface CortexPattern {
  id?: number;
  name: string;
  intent: string;
  body: string;
  uses?: string[];
  tags?: string[];
  approvedAt?: string;
  useCount?: number;
  revertedCount?: number;
  survivalRate?: number;
}

export interface CortexAntiPattern {
  id?: number;
  description: string;
  wrong: string;
  correct: string;
  tags?: string[];
  addedAt?: string;
}

export interface CortexTestOutcome {
  sessionId: string;
  command: string;
  passed: boolean;
}

class CortexDb {
  private db: Database.Database | null = null;
  private readonly dbPath: string;

  constructor() {
    this.dbPath = path.resolve('D:\\AgenticOS', '.cortex', 'memory.db');
  }

  public init(): Database.Database | null {
    if (this.db) return this.db;

    try {
      const dir = path.dirname(this.dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      this.db = new Database(this.dbPath, { timeout: 5000 });
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('foreign_keys = ON');
      this.db.pragma('busy_timeout = 5000');
      this.db.pragma('synchronous = NORMAL');

      this.migrate();
      this.seedInitialKnowledge();

      logger.info('[CortexDb] Connected to shared Cortex database at ' + this.dbPath);
      return this.db;
    } catch (err: any) {
      logger.warn('[CortexDb] Could not initialize Cortex database: ' + err?.message);
      this.db = null;
      return null;
    }
  }

  private migrate(): void {
    if (!this.db) return;

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS code_units (
        id          TEXT PRIMARY KEY,
        kind        TEXT NOT NULL,
        name        TEXT NOT NULL,
        module_path TEXT NOT NULL,
        summary     TEXT NOT NULL,
        compressed  TEXT NOT NULL,
        term_vector TEXT NOT NULL,
        indexed_at  TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS code_members (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        parent_id   TEXT NOT NULL REFERENCES code_units(id) ON DELETE CASCADE,
        kind        TEXT NOT NULL,
        name        TEXT NOT NULL,
        type_sig    TEXT NOT NULL,
        doc         TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_members_parent ON code_members(parent_id);
      CREATE INDEX IF NOT EXISTS idx_units_name ON code_units(name);
      CREATE INDEX IF NOT EXISTS idx_units_kind ON code_units(kind);

      CREATE TABLE IF NOT EXISTS patterns (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        name           TEXT NOT NULL,
        intent         TEXT NOT NULL,
        body           TEXT NOT NULL,
        uses           TEXT NOT NULL,
        tags           TEXT NOT NULL,
        approved_at    TEXT NOT NULL,
        use_count      INTEGER NOT NULL DEFAULT 0,
        reverted_count INTEGER NOT NULL DEFAULT 0,
        survival_rate  REAL NOT NULL DEFAULT 1.0
      );

      CREATE TABLE IF NOT EXISTS anti_patterns (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        description TEXT NOT NULL,
        wrong       TEXT NOT NULL,
        correct     TEXT NOT NULL,
        tags        TEXT NOT NULL,
        added_at    TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS test_outcomes (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id   TEXT    NOT NULL,
        command      TEXT    NOT NULL,
        passed       INTEGER NOT NULL,
        observed_at  INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE INDEX IF NOT EXISTS idx_test_outcomes_session ON test_outcomes(session_id);

      CREATE TABLE IF NOT EXISTS recurring_errors (
        signature     TEXT PRIMARY KEY,
        sample        TEXT NOT NULL,
        command       TEXT NOT NULL,
        sessions      TEXT NOT NULL DEFAULT '[]',
        seen_count    INTEGER NOT NULL DEFAULT 1,
        proposed      INTEGER NOT NULL DEFAULT 0,
        first_seen_at INTEGER NOT NULL DEFAULT (unixepoch()),
        last_seen_at  INTEGER NOT NULL DEFAULT (unixepoch())
      );

      CREATE TABLE IF NOT EXISTS challenges (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id  TEXT NOT NULL,
        cue         TEXT NOT NULL,
        excerpt     TEXT NOT NULL,
        verdict     TEXT,
        subject     TEXT,
        evidence    TEXT,
        raised_at   INTEGER NOT NULL DEFAULT (unixepoch()),
        resolved_at INTEGER
      );
    `);
  }

  private seedInitialKnowledge(): void {
    if (!this.db) return;

    const count = this.db.prepare('SELECT COUNT(*) as cnt FROM anti_patterns').get() as { cnt: number };
    if (count && count.cnt > 0) return;

    const seeds = [
      {
        description: 'Assuming spoken email input has standard user@domain.com formatting — STT often outputs spaces and words like "at", "dot", "punkt"',
        wrong: 'const emailMatch = prompt.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}/); // fails on "CD International Project at Gmail.com"',
        correct: 'normalizeSpokenEmailAddress(prompt) converts words and phonetic spacing into standard user@domain format',
        tags: ['voice', 'stt', 'email', 'gmail', 'continuation', 'trap'],
      },
      {
        description: 'Allowing engineering delegation (Hermes/Codex) to hijack turns while an interactive user task (e.g. email composition) is awaiting input',
        wrong: 'Fall through to general supervisor loop when recipient matching fails -> routes to Hermes because prompt had word "Project"',
        correct: 'Check active task / draft state first; preserve task context and ask clarification question instead of delegating to engineering',
        tags: ['turn_lifecycle', 'task_state', 'hermes', 'delegation', 'email', 'continuation'],
      },
      {
        description: 'Silent failure in TurnLifecycleController without notifying SelfHeal supervisor',
        wrong: 'record.outcome = FAILED; log warning and complete turn without opening self-heal incident',
        correct: 'Call raiseSelfHealIncident with requestId, component, and symptom whenever outcome is FAILED',
        tags: ['self_heal', 'turn_lifecycle', 'failure_detector', 'incident_tracking'],
      },
      {
        description: 'Modifying production codebase in-process during self-healing repair without isolated worktree testing',
        wrong: 'Edit files in live repository directly and restart production server',
        correct: 'Create isolated worktree snapshot in D:\\AgenticOS-Recovery, run tests against baseline, verify repair, and await explicit approval',
        tags: ['self_heal', 'isolation', 'worktree', 'deployment_gate', 'safety'],
      },
    ];

    const stmt = this.db.prepare(`
      INSERT INTO anti_patterns (description, wrong, correct, tags, added_at)
      VALUES (?, ?, ?, ?, ?)
    `);

    const now = new Date().toISOString();
    for (const s of seeds) {
      stmt.run(s.description, s.wrong, s.correct, JSON.stringify(s.tags), now);
    }

    logger.info(`[CortexDb] Seeded ${seeds.length} engineering anti-patterns.`);
  }

  public getAntiPatterns(tagFilter?: string): CortexAntiPattern[] {
    try {
      const db = this.init();
      if (!db) return [];
      let rows: any[];
      if (tagFilter) {
        rows = db.prepare('SELECT * FROM anti_patterns WHERE tags LIKE ? ORDER BY id DESC').all(`%${tagFilter}%`);
      } else {
        rows = db.prepare('SELECT * FROM anti_patterns ORDER BY id DESC').all();
      }
      return rows.map((r) => ({
        id: r.id,
        description: r.description,
        wrong: r.wrong,
        correct: r.correct,
        tags: JSON.parse(r.tags || '[]'),
        addedAt: r.added_at,
      }));
    } catch (err: any) {
      logger.warn('[CortexDb] Failed to get anti-patterns: ' + err?.message);
      return [];
    }
  }

  public addAntiPattern(ap: CortexAntiPattern): boolean {
    try {
      const db = this.init();
      if (!db) return false;
      db.prepare(`
        INSERT INTO anti_patterns (description, wrong, correct, tags, added_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        ap.description,
        ap.wrong,
        ap.correct,
        JSON.stringify(ap.tags || []),
        ap.addedAt || new Date().toISOString()
      );
      return true;
    } catch (err: any) {
      logger.warn('[CortexDb] Failed to add anti-pattern: ' + err?.message);
      return false;
    }
  }

  public addPattern(p: CortexPattern): boolean {
    try {
      const db = this.init();
      if (!db) return false;
      db.prepare(`
        INSERT INTO patterns (name, intent, body, uses, tags, approved_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        p.name,
        p.intent,
        p.body,
        JSON.stringify(p.uses || []),
        JSON.stringify(p.tags || []),
        p.approvedAt || new Date().toISOString()
      );
      return true;
    } catch (err: any) {
      logger.warn('[CortexDb] Failed to add pattern: ' + err?.message);
      return false;
    }
  }

  public searchPatterns(query: string): CortexPattern[] {
    try {
      const db = this.init();
      if (!db) return [];
      const rows = db.prepare(`
        SELECT * FROM patterns
        WHERE name LIKE ? OR intent LIKE ? OR body LIKE ? OR tags LIKE ?
        ORDER BY id DESC LIMIT 10
      `).all(`%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`);

      return rows.map((r: any) => ({
        id: r.id,
        name: r.name,
        intent: r.intent,
        body: r.body,
        uses: JSON.parse(r.uses || '[]'),
        tags: JSON.parse(r.tags || '[]'),
        approvedAt: r.approved_at,
        useCount: r.use_count,
        survivalRate: r.survival_rate,
      }));
    } catch (err: any) {
      logger.warn('[CortexDb] Failed to search patterns: ' + err?.message);
      return [];
    }
  }

  public recordTestOutcome(outcome: CortexTestOutcome): void {
    try {
      const db = this.init();
      if (!db) return;
      db.prepare(`
        INSERT INTO test_outcomes (session_id, command, passed)
        VALUES (?, ?, ?)
      `).run(outcome.sessionId, outcome.command, outcome.passed ? 1 : 0);
    } catch (err: any) {
      logger.warn('[CortexDb] Failed to record test outcome: ' + err?.message);
    }
  }

  public recordRecurringError(signature: string, sample: string, command: string, sessionId: string): void {
    try {
      const db = this.init();
      if (!db) return;
      const existing = db.prepare('SELECT * FROM recurring_errors WHERE signature = ?').get(signature) as any;
      if (existing) {
        const sessions: string[] = JSON.parse(existing.sessions || '[]');
        if (!sessions.includes(sessionId)) sessions.push(sessionId);
        db.prepare(`
          UPDATE recurring_errors
          SET seen_count = seen_count + 1, sessions = ?, last_seen_at = unixepoch()
          WHERE signature = ?
        `).run(JSON.stringify(sessions), signature);
      } else {
        db.prepare(`
          INSERT INTO recurring_errors (signature, sample, command, sessions, seen_count)
          VALUES (?, ?, ?, ?, 1)
        `).run(signature, sample, command, JSON.stringify([sessionId]));
      }
    } catch (err: any) {
      logger.warn('[CortexDb] Failed to record recurring error: ' + err?.message);
    }
  }
}

export const cortexDb = new CortexDb();
