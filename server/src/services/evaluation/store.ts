/**
 * evaluation/store.ts — persistence for model evaluations (C7).
 *
 * Evaluations are persisted SEPARATELY from normal execution/project data in
 * their own `model_evaluations` table. No API secrets are ever stored.
 */
import { rawDb } from '../../db/index.js';
import type { EvalRunResult } from './types.js';

function initEvalTable() {
  try {
    rawDb.exec(`
      CREATE TABLE IF NOT EXISTS model_evaluations (
        id TEXT PRIMARY KEY,
        case_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        outcome TEXT NOT NULL,
        output TEXT,
        latency_ms INTEGER,
        first_token_ms INTEGER,
        total_tokens INTEGER,
        prompt_tokens INTEGER,
        completion_tokens INTEGER,
        tool_call_count INTEGER,
        tool_errors INTEGER,
        structured_output_valid INTEGER,
        error TEXT,
        verifier TEXT,
        started_at TEXT NOT NULL,
        completed_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_eval_case ON model_evaluations(case_id, completed_at);
      CREATE INDEX IF NOT EXISTS idx_eval_provider ON model_evaluations(provider, model);
    `);
  } catch (err: any) {
    // Table may already exist in an older shape; ignore.
  }
}

initEvalTable();

export interface EvalStoredRecord {
  id: string;
  caseId: string;
  provider: string;
  model: string;
  outcome: string;
  latencyMs: number;
  firstTokenMs: number;
  totalTokens?: number;
  completedAt: string;
}

export function persistEvalResult(result: EvalRunResult): string {
  const id = `eval-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const stmt = rawDb.prepare(`
    INSERT INTO model_evaluations (
      id, case_id, provider, model, outcome, output, latency_ms, first_token_ms,
      total_tokens, prompt_tokens, completion_tokens, tool_call_count, tool_errors,
      structured_output_valid, error, verifier, started_at, completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    id,
    result.caseId,
    result.provider,
    result.model,
    result.outcome,
    result.output?.slice(0, 2000) || null,
    result.latencyMs,
    result.firstTokenMs,
    result.totalTokens ?? null,
    result.promptTokens ?? null,
    result.completionTokens ?? null,
    result.toolCallCount,
    result.toolErrors,
    result.structuredOutputValid ? 1 : 0,
    result.error || null,
    result.verifier,
    result.startedAt,
    result.completedAt,
  );
  return id;
}

export function listRecentEvals(limit = 100): EvalStoredRecord[] {
  const rows: any[] = rawDb.prepare(
    `SELECT id, case_id, provider, model, outcome, latency_ms, first_token_ms, total_tokens, completed_at
     FROM model_evaluations ORDER BY completed_at DESC LIMIT ?`,
  ).all(limit);
  return rows.map((r) => ({
    id: r.id,
    caseId: r.case_id,
    provider: r.provider,
    model: r.model,
    outcome: r.outcome,
    latencyMs: r.latency_ms,
    firstTokenMs: r.first_token_ms,
    totalTokens: r.total_tokens,
    completedAt: r.completed_at,
  }));
}

export function countEvals(): number {
  const row: any = rawDb.prepare('SELECT COUNT(*) AS c FROM model_evaluations').get();
  return row?.c || 0;
}
