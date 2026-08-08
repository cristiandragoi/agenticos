import React, { useState } from 'react';
import { useBackendLifecycle } from '../../diagnostics/useBackendLifecycle';
import { backendLifecycleStore } from '../../diagnostics/backendLifecycleStore';

/**
 * Persistent backend connection indicator (backend lifecycle milestone).
 *
 * 🟢 connected · 🟡 starting/reconnecting · 🔴 offline/failed — plus an
 * expandable Backend diagnostics section (mode, port, pid, restart count,
 * last health, recent redacted backend log) with Retry / Restart controls.
 *
 * Reads ONLY the shared lifecycle store; in EXTERNAL mode Restart explains
 * that Electron does not own the process.
 */

function formatAge(ts: number | null): string {
  if (!ts) return '—';
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  return `${Math.round(s / 60)}m ago`;
}

const STATUS_META: Record<string, { dot: string; text: string; label: string }> = {
  ready: { dot: '#4ade80', text: '#4ade80', label: 'Backend connected' },
  starting: { dot: '#fbbf24', text: '#fbbf24', label: 'Backend starting' },
  reconnecting: { dot: '#fbbf24', text: '#fbbf24', label: 'Reconnecting' },
  offline: { dot: '#f87171', text: '#f87171', label: 'Backend offline' },
  failed: { dot: '#f87171', text: '#f87171', label: 'Backend failed' },
};

const BackendStatusIndicator: React.FC = () => {
  const state = useBackendLifecycle();
  const [open, setOpen] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const meta = STATUS_META[state.status] ?? STATUS_META.starting;

  const suffix =
    state.status === 'ready' ? ` · :${state.port}` :
    state.status === 'reconnecting' && state.restartCount > 0 ? ` · attempt ${Math.min(state.restartCount, 3)}/3` :
    '';

  const handleRetry = async () => {
    setActionMsg(null);
    const res = await backendLifecycleStore.retry();
    if (!res.ok && res.reason) setActionMsg(res.reason);
  };
  const handleRestart = async () => {
    setActionMsg(null);
    const res = await backendLifecycleStore.restart();
    if (!res.ok && res.reason) setActionMsg(res.reason);
  };

  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end' }}>
      <button
        data-testid="backend-status-chip"
        data-status={state.status}
        data-mode={state.mode}
        onClick={() => setOpen((v) => !v)}
        title={`${meta.label}${suffix} — mode ${state.mode}`}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '3px 8px', borderRadius: 6,
          background: 'rgba(30,41,59,0.6)', border: '1px solid rgba(51,65,85,0.5)',
          color: meta.text, fontSize: 10, fontWeight: 600, letterSpacing: '0.02em',
          cursor: 'pointer', whiteSpace: 'nowrap',
        }}
      >
        <span
          data-testid="backend-status-dot"
          style={{
            width: 7, height: 7, borderRadius: '50%', background: meta.dot, display: 'inline-block',
            animation: state.status === 'starting' || state.status === 'reconnecting' ? 'backendChipPulse 1.2s ease-in-out infinite' : undefined,
          }}
        />
        Backend: {state.status === 'ready' ? 'Connected' : state.status === 'starting' ? 'Starting…' : state.status === 'reconnecting' ? 'Reconnecting' : state.status === 'offline' ? 'Offline' : 'Failed'}
        {suffix}
      </button>

      {open && (
        <div
          data-testid="backend-diagnostics-panel"
          style={{
            marginTop: 6, width: 340, zIndex: 10000,
            background: '#0f172a', border: '1px solid #334155', borderRadius: 8,
            padding: 12, fontSize: 11, color: '#cbd5e1', textAlign: 'left',
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 8, color: '#e2e8f0' }}>Backend diagnostics</div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              {[
                ['Mode', state.mode],
                ['Status', state.status.toUpperCase()],
                ['Port', `:${state.port}`],
                ['PID', state.owned && state.pid ? String(state.pid) : state.owned ? 'starting…' : 'external / adopted'],
                ['Last health OK', formatAge(state.lastHealthSuccessAt)],
                ['Last health failure', formatAge(state.lastHealthFailureAt)],
                ['Restart attempts', String(state.restartCount)],
                ['Readiness (last start)', state.readinessMs != null ? `${(state.readinessMs / 1000).toFixed(1)}s` : '—'],
              ].map(([k, v]) => (
                <tr key={k}>
                  <td style={{ padding: '2px 6px 2px 0', color: '#94a3b8' }}>{k}</td>
                  <td style={{ padding: '2px 0', fontFamily: 'monospace' }}>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {state.lastError && (
            <div data-testid="backend-diagnostics-error" style={{ marginTop: 8, padding: 8, background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', borderRadius: 6, color: '#fca5a5' }}>
              {state.lastError}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button
              data-testid="backend-diagnostics-retry"
              onClick={() => void handleRetry()}
              style={{ padding: '4px 12px', borderRadius: 6, border: '1px solid #475569', background: '#1e293b', color: '#e2e8f0', cursor: 'pointer', fontSize: 11 }}
            >
              Retry connection
            </button>
            <button
              data-testid="backend-diagnostics-restart"
              onClick={() => void handleRestart()}
              style={{ padding: '4px 12px', borderRadius: 6, border: '1px solid #475569', background: '#1e293b', color: '#e2e8f0', cursor: 'pointer', fontSize: 11 }}
            >
              Restart backend
            </button>
          </div>
          {actionMsg && (
            <div data-testid="backend-diagnostics-action-msg" style={{ marginTop: 8, color: '#fbbf24' }}>{actionMsg}</div>
          )}

          {state.recentLog.length > 0 && (
            <details style={{ marginTop: 10 }}>
              <summary style={{ cursor: 'pointer', color: '#94a3b8' }}>Recent backend output ({state.recentLog.length} lines, secrets redacted)</summary>
              <pre
                data-testid="backend-diagnostics-log"
                style={{ maxHeight: 160, overflow: 'auto', marginTop: 6, padding: 8, background: '#020617', borderRadius: 6, fontSize: 10, color: '#94a3b8', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}
              >
                {state.recentLog.join('\n')}
              </pre>
            </details>
          )}
        </div>
      )}

      <style>{`
        @keyframes backendChipPulse { 0%,100% { opacity: 1; } 50% { opacity: 0.35; } }
      `}</style>
    </div>
  );
};

export default BackendStatusIndicator;
