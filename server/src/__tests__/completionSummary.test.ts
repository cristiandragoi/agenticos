/**
 * TASK_COMPLETED user-experience event (task-completion milestone).
 *
 * Covers: one event per operation, no duplicate announcements, text summary,
 * voice summary (same event), partial/failure/cancelled wording, multiple
 * simultaneous events, acknowledgement persistence semantics.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildCompletionEvent } from '../services/completionSummary.js';
import type { ExecutionRecord } from '../services/executionState.js';

function rec(overrides: Partial<ExecutionRecord> = {}): ExecutionRecord {
  return {
    operationId: 'op-1',
    worker: 'revenue',
    status: 'COMPLETED',
    currentAction: null,
    requestedProvider: null,
    requestedModel: null,
    resolvedProvider: null,
    resolvedModel: null,
    fallbackUsed: false,
    fallbackReason: null,
    startedAt: 1000,
    endedAt: 110000,
    lastActivityAt: 110000,
    queuePosition: null,
    activeCount: null,
    limit: null,
    result: 'Revenue pipeline completed — COMPLETED 5/5 qualified leads found.\n\n1. Kadabau\nTop prospect: Kadabau (https://www.kadabau.de)',
    cancel: null,
    discoveredCount: 10,
    qualifiedCount: 8,
    rejectedCount: 2,
    targetCount: 5,
    note: null,
    ...overrides,
  } as ExecutionRecord;
}

describe('completion event builder', () => {
  it('builds ONE semantic event per terminal operation with the revenue wording', () => {
    const evt = buildCompletionEvent(rec(), {
      taskType: 'revenue search',
      niche: 'roofing',
      city: 'Berlin',
      requestedCount: 5,
      resultCount: 5,
      topResult: 'Kadabau',
    });
    expect(evt?.kind).toBe('TASK_COMPLETED');
    expect(evt?.status).toBe('COMPLETED');
    expect(evt?.summary).toBe(
      "I've finished the search. I found 5 qualified roofing companies in Berlin. Kadabau is currently the strongest prospect. No outreach was performed. The full report is ready."
    );
    expect(evt?.spokenSummary).toBe(evt?.summary); // same event → no disagreement
    expect(evt?.resultCount).toBe(5);
    expect(evt?.requestedCount).toBe(5);
    expect(evt?.topResult).toBe('Kadabau');
    expect(evt?.durationMs).toBe(109000);
    expect(evt?.resultAvailable).toBe(true);
  });

  it('returns null for non-terminal records', () => {
    expect(buildCompletionEvent(rec({ status: 'RUNNING' }))).toBeNull();
    expect(buildCompletionEvent(rec({ status: 'WAITING_FOR_USER' }))).toBeNull();
  });

  it('returns null for plain Jarvis direct replies (the reply IS the announcement)', () => {
    expect(buildCompletionEvent(rec({ worker: 'jarvis' }))).toBeNull();
  });

  it('marks PARTIAL when resultCount < requestedCount', () => {
    const evt = buildCompletionEvent(rec(), {
      taskType: 'revenue search',
      niche: 'roofing',
      city: 'Berlin',
      requestedCount: 5,
      resultCount: 4,
      topResult: 'Kadabau',
    });
    expect(evt?.status).toBe('PARTIAL');
    expect(evt?.summary).toContain('I could verify only 4 of the 5 requested roofing leads in Berlin');
    expect(evt?.summary).toContain('The full report is ready.');
  });

  it('uses truthful FAILED wording with the reason', () => {
    const evt = buildCompletionEvent(rec({ status: 'FAILED' }), { taskType: 'revenue search', detail: 'The discovery source timed out after all retries.' });
    expect(evt?.status).toBe('FAILED');
    expect(evt?.summary).toBe('The task did not complete. The discovery source timed out after all retries.');
  });

  it('uses truthful CANCELLED wording', () => {
    const evt = buildCompletionEvent(rec({ status: 'CANCELLED' }), { taskType: 'revenue search' });
    expect(evt?.status).toBe('CANCELLED');
    expect(evt?.summary).toBe('The task was cancelled.');
  });

  it('builds the CodeX wording with the issue count', () => {
    const evt = buildCompletionEvent(rec({ worker: 'codex' }), { taskType: 'code inspection', resultCount: 2 });
    expect(evt?.worker).toBe('codex');
    expect(evt?.summary).toContain('CodeX finished the inspection. It found 2 issue(s). No files were changed.');
  });

  it('builds the Hermes wording', () => {
    const evt = buildCompletionEvent(rec({ worker: 'hermes' }), { taskType: 'hermes' });
    expect(evt?.summary).toBe('Hermes finished the task successfully. I have the result ready for you.');
  });
});

describe('completion publisher — one event per operation, never replays', () => {
  beforeEach(() => { vi.resetModules(); });

  it('publishes once per operation and dedupes replays', async () => {
    const { publishCompletion, onCompletion } = await import('../routers/execution.js');
    const seen: string[] = [];
    const off = onCompletion((e) => seen.push(e.operationId));
    const evt = buildCompletionEvent(rec(), { taskType: 'revenue search', requestedCount: 5, resultCount: 5, topResult: 'Kadabau' })!;
    expect(publishCompletion(evt)).toBe(true);
    expect(publishCompletion(evt)).toBe(false); // same operation → no replay
    expect(seen).toEqual(['op-1']);
    off();
  });

  it('keeps multiple simultaneous operations separate (no overwrite)', async () => {
    const { publishCompletion, onCompletion } = await import('../routers/execution.js');
    const seen: string[] = [];
    const off = onCompletion((e) => seen.push(`${e.operationId}:${e.status}`));
    const a = buildCompletionEvent(rec({ operationId: 'op-rev', qualifiedCount: 10, targetCount: 10 }), { taskType: 'revenue search', requestedCount: 10, resultCount: 10, topResult: 'Kadabau' })!;
    const b = buildCompletionEvent(rec({ operationId: 'op-codex', worker: 'codex' }), { taskType: 'code inspection', resultCount: 2 })!;
    publishCompletion(a);
    publishCompletion(b);
    expect(seen).toEqual(['op-rev:COMPLETED', 'op-codex:COMPLETED']);
    off();
  });
});
