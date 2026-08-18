import React from 'react';

/* Jarvis insights (Phase 3 slice 2) — every row is REAL runtime data, never
 * filler. Rows render '—' when the underlying signal is absent. */
export interface JarvisInsightsProps {
  runtimeStatus: {
    state: string;
    error?: string | null;
    provider?: string | null;
    model?: string | null;
    firstTokenMs?: number | null;
  };
  backendRuntime: {
    state: string;
    activeAgent?: string | null;
    activeProject?: { id: string; name?: string } | null;
    activeTask?: { id: string; action: string | null; status: string } | null;
    pendingTaskCount: number;
  };
  orbState: string;
  lastUserPrompt?: string | null;
  lastReply?: string | null;
}

const ROW_LABELS: { key: string; label: string }[] = [
  { key: 'understood', label: 'UNDERSTOOD' },
  { key: 'thinking', label: 'THINKING / PLAN' },
  { key: 'research', label: 'RESEARCH / KNOWLEDGE' },
  { key: 'active', label: 'ACTIVE WORK' },
  { key: 'delegated', label: 'DELEGATED' },
  { key: 'result', label: 'RESULT' },
  { key: 'blocked', label: 'BLOCKED / ATTENTION' },
];

export function JarvisInsights({ runtimeStatus, backendRuntime, orbState, lastUserPrompt, lastReply }: JarvisInsightsProps) {
  const state = runtimeStatus.state || 'idle';
  const action = (backendRuntime.activeTask?.action || '').toLowerCase();

  const values: Record<string, string> = {
    understood: lastUserPrompt?.trim() || (state === 'understanding' ? 'Reading input…' : '—'),
    thinking: ['planning', 'thinking'].includes(state)
      ? (backendRuntime.activeTask?.action || state)
      : '—',
    research: /research|knowledge|search|web|source|review/.test(action)
      ? (backendRuntime.activeTask?.action || 'Reviewing sources…')
      : '—',
    active: backendRuntime.activeTask
      ? `${backendRuntime.activeTask.action || 'working'} · ${backendRuntime.activeTask.status}`
      : (['executing', 'streaming'].includes(state) ? state : '—'),
    delegated: (state === 'delegating' || orbState === 'delegated')
      ? (backendRuntime.activeAgent || 'Delegating…')
      : '—',
    result: lastReply?.trim() || '—',
    blocked: runtimeStatus.error
      ? runtimeStatus.error.slice(0, 120)
      : state === 'approval_required'
        ? 'Approval required'
        : state === 'cancelled'
          ? 'Cancelled'
          : state === 'error'
            ? 'Error'
            : '—',
  };

  return (
    <div
      data-testid="jarvis-insights"
      style={{
        display: 'grid',
        // Responsive: 7 columns when the dock is wide; wraps to 2+ rows on
        // narrower viewports so headings never collide. Min 150px per cell
        // keeps labels readable (no microscopic text).
        gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
        gap: '8px 14px',
        width: '100%',
        padding: '8px 12px',
        background: 'rgba(2, 12, 18, 0.55)',
        border: '1px solid rgba(0, 229, 255, 0.14)',
        borderRadius: 12,
        boxSizing: 'border-box',
      }}
    >
      {ROW_LABELS.map(({ key, label }) => {
        const v = values[key];
        const active = v !== '—';
        const blocked = key === 'blocked' && active;
        return (
          <div key={key} style={{ minWidth: 0 }} data-insight={key}>
            <div style={{ fontSize: 10, letterSpacing: '0.08em', color: blocked ? '#fca5a5' : 'rgba(0,229,255,0.65)', fontWeight: 600, marginBottom: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {label}
            </div>
            <div
              title={v}
              style={{
                fontSize: 11,
                lineHeight: 1.35,
                color: blocked ? '#fecaca' : active ? '#d9fbff' : 'rgba(148,163,184,0.55)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                display: '-webkit-box',
                WebkitLineClamp: 3,
                WebkitBoxOrient: 'vertical',
                wordBreak: 'break-word',
              }}
            >
              {v}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default JarvisInsights;
