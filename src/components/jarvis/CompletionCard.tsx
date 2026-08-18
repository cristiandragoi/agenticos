/**
 * Task-completion card (task-completion milestone).
 *
 * One semantic completion card per finished operation: ✓ Task complete,
 * worker/taskType, result count, top result, duration, and a details toggle.
 * The execution bar's red STOP is never shown here — the card appears after
 * the canonical state reached COMPLETED/FAILED/CANCELLED.
 */
import { useState } from 'react';
import type { CompletionEvent } from '../../diagnostics/executionStore';
import { acknowledgeCompletion } from '../../diagnostics/executionStore';

const STATUS_META: Record<string, { label: string; color: string }> = {
  COMPLETED: { label: 'Task complete', color: '#4ade80' },
  PARTIAL: { label: 'Partially complete', color: '#fbbf24' },
  FAILED: { label: 'Task did not complete', color: '#f87171' },
  CANCELLED: { label: 'Task cancelled', color: '#94a3b8' },
};

function fmtDuration(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r ? `${m}m ${r}s` : `${m}m`;
}

export function CompletionCard({ event }: { event: CompletionEvent }) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const meta = STATUS_META[event.status] || STATUS_META.COMPLETED;

  return (
    <div
      data-testid="completion-card"
      data-status={event.status}
      style={{
        background: 'rgba(15,23,42,0.97)', border: `1px solid ${meta.color}55`,
        borderRadius: 12, padding: '10px 14px', margin: '6px 0',
        fontSize: 12, color: '#e2e8f0', maxWidth: 520,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span data-testid="completion-check" style={{ color: meta.color, fontWeight: 800 }}>✓</span>
        <span style={{ fontWeight: 700, color: meta.color }}>{meta.label}</span>
        <span style={{ color: '#94a3b8' }}>·</span>
        <span style={{ fontWeight: 600 }}>{event.taskType}</span>
        {event.status !== 'FAILED' && event.status !== 'CANCELLED' && event.resultCount != null && (
          <span data-testid="completion-count" style={{ background: '#1e293b', borderRadius: 6, padding: '1px 8px', color: '#a5b4fc' }}>
            {event.resultCount}{event.requestedCount != null ? `/${event.requestedCount}` : ''} qualified
          </span>
        )}
      </div>
      <div style={{ color: '#cbd5e1', marginTop: 4 }}>{event.summary}</div>
      {event.topResult && (
        <div style={{ color: '#93c5fd', marginTop: 4 }}>
          Top prospect: <span style={{ fontWeight: 700 }}>{event.topResult}</span>
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6, color: '#64748b', fontSize: 11 }}>
        <span>Completed in {fmtDuration(event.durationMs)}</span>
        <button
          onClick={() => setDetailsOpen((o) => !o)}
          style={{ background: 'transparent', border: '1px solid #334155', color: '#94a3b8', borderRadius: 6, padding: '2px 8px', cursor: 'pointer', fontSize: 11 }}
        >
          {detailsOpen ? 'Hide details' : 'View full report'}
        </button>
        <button
          data-testid="completion-dismiss"
          onClick={() => { acknowledgeCompletion(event.operationId); }}
          style={{ background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 11 }}
        >
          Dismiss
        </button>
      </div>
      {detailsOpen && (
        <div
          data-testid="completion-details"
          style={{
            marginTop: 8, borderTop: '1px solid #1e293b', paddingTop: 8,
            color: '#94a3b8', maxHeight: 180, overflowY: 'auto', whiteSpace: 'pre-wrap',
            fontFamily: 'monospace', fontSize: 11,
          }}
        >
          {event.resultAvailable ? 'The full result is in the conversation transcript below.' : 'No detailed result text was produced.'}
          {'\n\n'}Operation: {event.operationId}
          {'\n'}Worker: {event.worker}
        </div>
      )}
    </div>
  );
}
