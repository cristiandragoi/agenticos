/**
 * turnLifecycle/store.ts — durable source of truth for every new request.
 *
 * better-sqlite3 is synchronous, so the duplicate check and the insert in
 * `claim()` run in one tick: two submissions of the same utterance can never
 * both be claimed.
 */
import { rawDb } from '../../db/index.js';
import { logger } from '../../utils/logger.js';
import type { TurnOutcome, TurnRecord, TurnRequest, TurnStage } from './types.js';

let ensured = false;

export function ensureTurnLifecycleTables(): void {
  if (ensured) return;
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS turn_lifecycle (
      request_id TEXT PRIMARY KEY,
      dedupe_key TEXT NOT NULL UNIQUE,
      source TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      context_key TEXT NOT NULL,
      external_turn_id TEXT,
      text TEXT NOT NULL,
      normalized_text TEXT NOT NULL,
      stt_confidence REAL,
      audio_ref TEXT,
      build_id TEXT NOT NULL,
      received_at TEXT NOT NULL,
      stage TEXT NOT NULL,
      goal_json TEXT,
      postcondition_json TEXT,
      policy_json TEXT,
      snapshot_json TEXT,
      receipt_json TEXT,
      verification_json TEXT,
      outcome TEXT CHECK (outcome IS NULL OR outcome IN ('VERIFIED','EXECUTED_UNVERIFIED','FAILED','BLOCKED')),
      outcome_reason TEXT,
      response_text TEXT,
      spoken INTEGER,
      handler TEXT,
      superseded_by TEXT,
      attached_json TEXT,
      error TEXT,
      completed_at TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_turn_lifecycle_conv ON turn_lifecycle(conversation_id, received_at);
    CREATE TABLE IF NOT EXISTS turn_lifecycle_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id TEXT NOT NULL,
      stage TEXT NOT NULL,
      at TEXT NOT NULL,
      detail_json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_turn_lifecycle_events_req ON turn_lifecycle_events(request_id);
  `);
  ensured = true;
}

export function normalizeForDedupe(text: string): string {
  return (text || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** Window inside which an identical utterance from the same source is the same utterance. */
export const DUPLICATE_WINDOW_MS = 5000;

export type ClaimResult =
  | { claimed: true }
  | { claimed: false; duplicateOf: string; reason: string };

/**
 * Atomically claim a request. Returns the existing request id when this
 * utterance has already been claimed (same transport turn id, or identical
 * normalized text from the same source+conversation within DUPLICATE_WINDOW_MS).
 */
export function claim(req: TurnRequest, contextKey: string): ClaimResult {
  ensureTurnLifecycleTables();
  const normalized = normalizeForDedupe(req.text);
  const dedupeKey = req.externalTurnId
    ? `${req.source}|${req.conversationId}|turn:${req.externalTurnId}`
    : `${req.source}|${req.conversationId}|req:${req.requestId}`;

  const byKey = rawDb.prepare('SELECT request_id FROM turn_lifecycle WHERE dedupe_key = ?').get(dedupeKey) as any;
  if (byKey) return { claimed: false, duplicateOf: byKey.request_id, reason: 'same_transport_turn' };

  const cutoff = new Date(Date.parse(req.receivedAt) - DUPLICATE_WINDOW_MS).toISOString();
  const recent = rawDb.prepare(
    `SELECT request_id FROM turn_lifecycle
      WHERE conversation_id = ? AND source = ? AND normalized_text = ? AND received_at >= ? AND outcome IS NULL
      ORDER BY received_at DESC LIMIT 1`,
  ).get(req.conversationId, req.source, normalized, cutoff) as any;
  if (recent) return { claimed: false, duplicateOf: recent.request_id, reason: 'identical_utterance_within_window' };

  const now = new Date().toISOString();
  rawDb.prepare(
    `INSERT INTO turn_lifecycle (request_id, dedupe_key, source, conversation_id, context_key, external_turn_id,
       text, normalized_text, stt_confidence, audio_ref, build_id, received_at, stage, attached_json, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    req.requestId, dedupeKey, req.source, req.conversationId, contextKey, req.externalTurnId ?? null,
    req.text, normalized, req.sttConfidence ?? null, req.audioRef ?? null, req.buildId, req.receivedAt,
    'RECEIVED', req.attached ? JSON.stringify(req.attached) : null, now,
  );
  appendEvent(req.requestId, 'RECEIVED', { source: req.source, buildId: req.buildId });
  return { claimed: true };
}

export function appendEvent(requestId: string, stage: TurnStage | string, detail?: unknown): void {
  try {
    rawDb.prepare('INSERT INTO turn_lifecycle_events (request_id, stage, at, detail_json) VALUES (?,?,?,?)')
      .run(requestId, stage, new Date().toISOString(), detail === undefined ? null : JSON.stringify(detail));
  } catch (err: any) {
    logger.warn('[TurnLifecycle] event persist failed', { requestId, stage, error: err?.message });
  }
}

const COLUMN_BY_FIELD: Record<string, string> = {
  goal: 'goal_json',
  postcondition: 'postcondition_json',
  policy: 'policy_json',
  snapshot: 'snapshot_json',
  receipt: 'receipt_json',
  verification: 'verification_json',
};

/** Persist a stage transition plus the artifact produced by that stage. */
export function recordStage(
  requestId: string,
  stage: TurnStage,
  artifacts: Partial<Pick<TurnRecord, 'goal' | 'postcondition' | 'policy' | 'snapshot' | 'receipt' | 'verification' | 'handler' | 'error'>> = {},
): void {
  const sets: string[] = ['stage = ?', 'updated_at = ?'];
  const values: unknown[] = [stage, new Date().toISOString()];
  for (const [field, value] of Object.entries(artifacts)) {
    if (value === undefined) continue;
    if (field === 'handler' || field === 'error') {
      sets.push(`${field} = ?`);
      values.push(value);
    } else if (COLUMN_BY_FIELD[field]) {
      sets.push(`${COLUMN_BY_FIELD[field]} = ?`);
      values.push(JSON.stringify(value));
    }
  }
  values.push(requestId);
  rawDb.prepare(`UPDATE turn_lifecycle SET ${sets.join(', ')} WHERE request_id = ?`).run(...values);
  appendEvent(requestId, stage, Object.keys(artifacts));
}

/**
 * Fix the ONE final outcome. Throws if an outcome already exists — a request
 * can never end twice.
 */
export function recordOutcome(requestId: string, outcome: TurnOutcome, reason: string): void {
  const res = rawDb.prepare(
    `UPDATE turn_lifecycle SET outcome = ?, outcome_reason = ?, stage = 'OUTCOME', updated_at = ?
      WHERE request_id = ? AND outcome IS NULL`,
  ).run(outcome, reason, new Date().toISOString(), requestId);
  if (res.changes !== 1) {
    throw new Error(`[TurnLifecycle] outcome already fixed for ${requestId}; refusing second outcome ${outcome}`);
  }
  appendEvent(requestId, 'OUTCOME', { outcome, reason });
}

export function recordResponse(requestId: string, responseText: string): void {
  rawDb.prepare(`UPDATE turn_lifecycle SET response_text = ?, stage = 'RESPONSE', updated_at = ? WHERE request_id = ?`)
    .run(responseText, new Date().toISOString(), requestId);
  appendEvent(requestId, 'RESPONSE', { length: responseText.length });
}

export function recordSpoken(requestId: string, spoken: boolean, detail?: unknown): void {
  rawDb.prepare(`UPDATE turn_lifecycle SET spoken = ?, stage = 'TTS', updated_at = ? WHERE request_id = ?`)
    .run(spoken ? 1 : 0, new Date().toISOString(), requestId);
  appendEvent(requestId, 'TTS', { spoken, detail });
}

export function recordDone(requestId: string): void {
  const now = new Date().toISOString();
  rawDb.prepare(`UPDATE turn_lifecycle SET stage = 'DONE', completed_at = ?, updated_at = ? WHERE request_id = ?`)
    .run(now, now, requestId);
  appendEvent(requestId, 'DONE');
}

export function markSuperseded(requestId: string, byRequestId: string): void {
  rawDb.prepare(`UPDATE turn_lifecycle SET superseded_by = ?, updated_at = ? WHERE request_id = ? AND completed_at IS NULL`)
    .run(byRequestId, new Date().toISOString(), requestId);
  appendEvent(requestId, 'SUPERSEDED', { by: byRequestId });
}

export interface PreviousTurnSummary {
  requestId: string;
  contextKey: string;
  text: string;
  responseText: string | null;
  outcome: string | null;
  goalSummary: string | null;
  receivedAt: string;
}

/** The most recent completed request in this conversation (for continuation decisions only). */
export function previousTurn(conversationId: string, beforeRequestId: string): PreviousTurnSummary | null {
  ensureTurnLifecycleTables();
  const row = rawDb.prepare(
    `SELECT request_id, context_key, text, response_text, outcome, goal_json, received_at
       FROM turn_lifecycle
      WHERE conversation_id = ? AND request_id <> ? AND outcome IS NOT NULL
      ORDER BY received_at DESC LIMIT 1`,
  ).get(conversationId, beforeRequestId) as any;
  if (!row) return null;
  let goalSummary: string | null = null;
  try { goalSummary = row.goal_json ? JSON.parse(row.goal_json).summary ?? null : null; } catch { /* ignore */ }
  return {
    requestId: row.request_id,
    contextKey: row.context_key,
    text: row.text,
    responseText: row.response_text,
    outcome: row.outcome,
    goalSummary,
    receivedAt: row.received_at,
  };
}

export function setContextKey(requestId: string, contextKey: string): void {
  rawDb.prepare('UPDATE turn_lifecycle SET context_key = ?, updated_at = ? WHERE request_id = ?')
    .run(contextKey, new Date().toISOString(), requestId);
}

export function getTurn(requestId: string): any | null {
  ensureTurnLifecycleTables();
  return rawDb.prepare('SELECT * FROM turn_lifecycle WHERE request_id = ?').get(requestId) ?? null;
}

export function listTurns(opts: { since?: string; conversationId?: string; limit?: number } = {}): any[] {
  ensureTurnLifecycleTables();
  const where: string[] = [];
  const vals: unknown[] = [];
  if (opts.since) { where.push('received_at >= ?'); vals.push(opts.since); }
  if (opts.conversationId) { where.push('conversation_id = ?'); vals.push(opts.conversationId); }
  const sql = `SELECT * FROM turn_lifecycle ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
               ORDER BY received_at DESC LIMIT ?`;
  vals.push(Math.min(Math.max(opts.limit ?? 50, 1), 500));
  return rawDb.prepare(sql).all(...vals) as any[];
}

export function listEvents(requestId: string): any[] {
  ensureTurnLifecycleTables();
  return rawDb.prepare('SELECT * FROM turn_lifecycle_events WHERE request_id = ? ORDER BY id').all(requestId) as any[];
}
