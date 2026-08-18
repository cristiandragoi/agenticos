/**
 * TASK_COMPLETED user-experience event (task-completion milestone).
 *
 * One semantic completion event per terminal operation — NEVER the internal
 * worker lifecycle events (reasoning.available, tool completed, result
 * verified). The text summary and the spoken summary are derived from the
 * SAME event so the text UI and voice can never disagree.
 */
import type { ExecutionRecord } from '../services/executionState.js';

export interface CompletionContext {
  taskId?: string | null;
  conversationId?: string | null;
  taskType?: string | null;
  niche?: string | null;
  city?: string | null;
  requestedCount?: number | null;
  resultCount?: number | null;
  topResult?: string | null;
  /** Override for FAILED/CANCELLED wording (e.g. the blocker reason). */
  detail?: string | null;
}

export interface TaskCompletedEvent {
  kind: 'TASK_COMPLETED';
  operationId: string;
  worker: string;
  taskType: string;
  status: 'COMPLETED' | 'PARTIAL' | 'FAILED' | 'CANCELLED';
  summary: string;
  resultCount: number | null;
  requestedCount: number | null;
  topResult: string | null;
  durationMs: number;
  completedAt: number;
  resultAvailable: boolean;
  spokenSummary: string;
  conversationId: string | null;
  taskId: string | null;
}

const COMPLETED_AT = 'COMPLETED';

function fmtWorker(worker: string): string {
  return worker === 'jarvis' ? 'Jarvis' : worker === 'codex' ? 'CodeX' : worker === 'hermes' ? 'Hermes' : worker === 'revenue' ? 'Revenue' : worker;
}

/** One concise sentence: which worker, what happened, the headline number. */
export function buildCompletionEvent(rec: ExecutionRecord, ctx: CompletionContext = {}): TaskCompletedEvent | null {
  if (rec.status !== 'COMPLETED' && rec.status !== 'FAILED' && rec.status !== 'CANCELLED') return null;
  // Direct Jarvis chat replies ARE the announcement — no separate completion UX.
  if (rec.worker === 'jarvis' && rec.status === COMPLETED_AT && !ctx.taskType) return null;

  const status: TaskCompletedEvent['status'] =
    rec.status === 'COMPLETED' && ctx.requestedCount != null && ctx.resultCount != null && ctx.resultCount < ctx.requestedCount
      ? 'PARTIAL'
      : rec.status;

  const resultCount = ctx.resultCount ?? rec.qualifiedCount ?? null;
  const requestedCount = ctx.requestedCount ?? rec.targetCount ?? null;
  const topResult = ctx.topResult ?? null;
  const niche = ctx.niche || null;
  const city = ctx.city || null;
  const worker = fmtWorker(rec.worker);
  const durationMs = (rec.endedAt || Date.now()) - rec.startedAt;

  // ── Text summary (1–3 sentences, summary FIRST, details second) ──
  let summary: string;
  if (status === 'CANCELLED') {
    summary = 'The task was cancelled.';
  } else if (status === 'FAILED') {
    summary = `The task did not complete.${ctx.detail ? ` ${ctx.detail}` : ''}`;
  } else if (status === 'PARTIAL') {
    summary =
      `I've finished the search, but I could verify only ${resultCount} of the ${requestedCount} requested ${niche || 'business'} leads${city ? ` in ${city}` : ''}.` +
      (topResult ? ` ${topResult} is currently the strongest prospect.` : '') +
      ' The full report is ready.';
  } else if (rec.worker === 'revenue') {
    summary =
      `I've finished the search. I found ${resultCount} qualified ${niche || 'business'} companies${city ? ` in ${city}` : ''}.` +
      (topResult ? ` ${topResult} is currently the strongest prospect.` : '') +
      ' No outreach was performed. The full report is ready.';
  } else if (rec.worker === 'codex') {
    summary = `CodeX finished the inspection. It found ${resultCount ?? 'some'} issue(s). No files were changed. The report is ready.`;
  } else {
    summary = `${worker} finished the task successfully. I have the result ready for you.`;
  }

  return {
    kind: 'TASK_COMPLETED',
    operationId: rec.operationId,
    worker: rec.worker,
    taskType: ctx.taskType || rec.worker,
    status,
    summary,
    resultCount,
    requestedCount,
    topResult,
    durationMs,
    completedAt: rec.endedAt || Date.now(),
    resultAvailable: Boolean(rec.result),
    spokenSummary: summary,
    conversationId: ctx.conversationId ?? null,
    taskId: ctx.taskId ?? null,
  };
}
