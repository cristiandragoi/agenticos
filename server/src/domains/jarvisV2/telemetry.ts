/**
 * telemetry.ts — Authoritative Telemetry Store for Jarvis V2 Voice Turns.
 *
 * Persists turn metrics in SQLite table `jarvis_v2_telemetry`.
 * Contains zero secrets.
 */

import { rawDb } from '../../db/index.js';

export interface V2VoiceTelemetryRecord {
  conversationId: string;
  operationId: string;
  turnId: number;
  sttRawTranscript: string;
  sttNormalizedTranscript: string;
  sttConfidence: number | null;
  classification: string;
  activeEntity: string | null;
  expectedInput: string | null;
  pendingActionId: string | null;
  currentTaskId: string | null;
  responseText: string;
  ttsStartedAt: number | null;
  ttsCompletedAt: number | null;
  interruptedByTurnId: number | null;
  totalLatencyMs: number;
  engine: 'jarvis-v2';
  createdAt: string;
}

const DDL = `
CREATE TABLE IF NOT EXISTS jarvis_v2_telemetry (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  turn_id INTEGER NOT NULL,
  stt_raw TEXT,
  stt_normalized TEXT,
  stt_confidence REAL,
  classification TEXT,
  active_entity TEXT,
  expected_input TEXT,
  pending_action_id TEXT,
  current_task_id TEXT,
  response_text TEXT,
  tts_started_at INTEGER,
  tts_completed_at INTEGER,
  interrupted_by_turn_id INTEGER,
  total_latency_ms INTEGER,
  engine TEXT NOT NULL DEFAULT 'jarvis-v2',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_v2_telem_conv ON jarvis_v2_telemetry(conversation_id);
`;

let initialized = false;
export function ensureTelemetryTable(): void {
  if (initialized) return;
  rawDb.exec(DDL);
  initialized = true;
}
ensureTelemetryTable();

export function recordVoiceTelemetry(entry: Omit<V2VoiceTelemetryRecord, 'createdAt'>): void {
  ensureTelemetryTable();
  const now = new Date().toISOString();
  try {
    rawDb.prepare(`
      INSERT INTO jarvis_v2_telemetry (
        conversation_id, operation_id, turn_id, stt_raw, stt_normalized,
        stt_confidence, classification, active_entity, expected_input,
        pending_action_id, current_task_id, response_text, tts_started_at,
        tts_completed_at, interrupted_by_turn_id, total_latency_ms, engine, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.conversationId,
      entry.operationId,
      entry.turnId,
      entry.sttRawTranscript,
      entry.sttNormalizedTranscript,
      entry.sttConfidence,
      entry.classification,
      entry.activeEntity,
      entry.expectedInput,
      entry.pendingActionId,
      entry.currentTaskId,
      entry.responseText,
      entry.ttsStartedAt,
      entry.ttsCompletedAt,
      entry.interruptedByTurnId,
      entry.totalLatencyMs,
      entry.engine,
      now
    );
  } catch (err) {
    // best-effort telemetry logging
  }
}

export function listVoiceTelemetry(conversationId: string): V2VoiceTelemetryRecord[] {
  ensureTelemetryTable();
  try {
    const rows = rawDb.prepare(`
      SELECT conversation_id, operation_id, turn_id, stt_raw, stt_normalized,
             stt_confidence, classification, active_entity, expected_input,
             pending_action_id, current_task_id, response_text, tts_started_at,
             tts_completed_at, interrupted_by_turn_id, total_latency_ms, engine, created_at
      FROM jarvis_v2_telemetry
      WHERE conversation_id = ?
      ORDER BY id ASC
    `).all(conversationId) as any[];

    return rows.map(r => ({
      conversationId: r.conversation_id,
      operationId: r.operation_id,
      turnId: r.turn_id,
      sttRawTranscript: r.stt_raw || '',
      sttNormalizedTranscript: r.stt_normalized || '',
      sttConfidence: r.stt_confidence,
      classification: r.classification || '',
      activeEntity: r.active_entity || null,
      expectedInput: r.expected_input || null,
      pendingActionId: r.pending_action_id || null,
      currentTaskId: r.current_task_id || null,
      responseText: r.response_text || '',
      ttsStartedAt: r.tts_started_at,
      ttsCompletedAt: r.tts_completed_at,
      interruptedByTurnId: r.interrupted_by_turn_id,
      totalLatencyMs: r.total_latency_ms,
      engine: 'jarvis-v2',
      createdAt: r.created_at,
    }));
  } catch {
    return [];
  }
}
