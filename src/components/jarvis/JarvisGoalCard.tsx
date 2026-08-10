import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, CheckCircle2, XCircle, Loader2, Terminal, FileCode } from 'lucide-react';
import styles from '../../pages/JarvisStudio.module.css';
import { deriveCurrentAction, TERMINAL_GOAL_STATES, type ConnectionState, type RunStatusColor } from '../../presenters/executionStatus';
import { normalizeExecutionEvent } from '../../utils/normalize';
import { apiFetch, apiUrl } from '../../api/client';

const COLOR_MAP: Record<RunStatusColor, string> = {
  green: 'var(--color-success)',
  blue: 'var(--color-jarvis)',
  yellow: 'var(--color-warning)',
  purple: 'var(--color-purple)',
  red: 'var(--color-error)',
  grey: 'var(--text-tertiary)'
};

interface JarvisGoalCardProps {
  goalId: string;
}

/**
 * Compact CodeX execution card for the Jarvis conversation.
 * Subscribes to the real goal event stream using the exact goalId returned
 * at creation, shows the live status/current action, and wires approval
 * controls to the real goal approval endpoint. The goalId is a prop, so a
 * stream reconnect never loses the run.
 */
export const JarvisGoalCard: React.FC<JarvisGoalCardProps> = ({ goalId }) => {
  const [goal, setGoal] = useState<any>(null);
  const [goalStatus, setGoalStatus] = useState<string | null>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [connection, setConnection] = useState<ConnectionState>('reconnecting');
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'approve' | 'cancel' | null>(null);
  const [streamNonce, setStreamNonce] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Initial goal snapshot (covers reloads before any live event arrives).
  useEffect(() => {
    let cancelled = false;
    const fetchGoal = async () => {
      try {
        const res = await apiFetch(`/api/chat/agents/goal/${goalId}`);
        if (!res.ok) throw new Error(`Goal lookup failed (${res.status})`);
        const data = await res.json();
        if (cancelled) return;
        setGoal(data);
        setGoalStatus(data.status);
        if (Array.isArray(data.history)) setEvents(data.history);
      } catch (err: any) {
        if (!cancelled) setActionError(err.message);
      }
    };
    fetchGoal();
    return () => { cancelled = true; };
  }, [goalId]);

  // Live event stream for this exact goalId.
  useEffect(() => {
    setConnection('reconnecting');
    const es = new EventSource(apiUrl(`/api/chat/agents/goal/stream/${goalId}`));

    es.onopen = () => setConnection('connected');

    es.addEventListener('goal_event', (e: any) => {
      try {
        const data = JSON.parse(e.data);
        setConnection('connected');
        if (data.state) setGoalStatus(data.state);
        setEvents(prev => {
          if (data.sequence !== undefined && prev.find(p => p.sequence === data.sequence)) return prev;
          return [...prev, data].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
        });
        if (data.state && TERMINAL_GOAL_STATES.includes(String(data.state).toLowerCase())) {
          es.close();
        }
      } catch (err) {}
    });

    es.onerror = () => {
      setConnection(es.readyState === EventSource.CLOSED ? 'disconnected' : 'reconnecting');
    };

    return () => es.close();
  }, [goalId, streamNonce]);

  const normalizedEvents = useMemo(() => events.map(normalizeExecutionEvent), [events]);
  const action = useMemo(
    () => deriveCurrentAction(goalStatus, normalizedEvents, connection),
    [goalStatus, normalizedEvents, connection]
  );

  const latestPlan = useMemo(() => {
    for (let i = normalizedEvents.length - 1; i >= 0; i--) {
      if ((normalizedEvents[i] as any).tool === 'plan' && normalizedEvents[i].message) {
        return normalizedEvents[i].message;
      }
    }
    return null;
  }, [normalizedEvents]);

  const recentEvents = normalizedEvents.slice(-5);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [normalizedEvents.length]);

  const statusColor = COLOR_MAP[action.color];
  const isTerminal = TERMINAL_GOAL_STATES.includes((goalStatus || '').toLowerCase());
  const needsApproval = (goalStatus || '').toLowerCase() === 'waiting_for_approval';

  const sendApproval = async (actionKind: 'resume' | 'abort') => {
    if (busy) return;
    setBusy(actionKind === 'resume' ? 'approve' : 'cancel');
    setActionError(null);
    try {
      const res = await apiFetch(`/api/chat/agents/goal/${goalId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: actionKind })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Approval failed (${res.status})`);
      if (actionKind === 'abort') setGoalStatus('stopped');
      // 'resume' status updates arrive through the event stream.
    } catch (err: any) {
      setActionError(err.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      data-testid="jarvis-goal-card"
      style={{
        border: `1px solid ${statusColor}`,
        borderRadius: '8px',
        background: 'rgba(255,255,255,0.02)',
        marginTop: '12px',
        marginBottom: '12px',
        overflow: 'hidden',
        width: '100%'
      }}
    >
      {/* Header */}
      <div style={{
        padding: '12px 16px',
        borderBottom: '1px solid var(--border-color)',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        background: 'rgba(56, 189, 248, 0.05)'
      }}>
        <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: statusColor, boxShadow: `0 0 8px ${statusColor}`, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 600, color: 'var(--text-primary)' }}>
            CodeX Goal <span style={{ fontFamily: 'monospace', fontSize: '0.8125rem', color: 'var(--text-tertiary)' }}>{goalId}</span>
          </h3>
          <p style={{ margin: 0, fontSize: '0.8125rem', color: statusColor }}>
            {action.statusLabel} — {action.message}
          </p>
        </div>
        <a
          href="#/codex"
          className={styles.actionBtn}
          style={{ textDecoration: 'none', display: 'flex', gap: '6px', flexShrink: 0 }}
        >
          <ExternalLink size={14} /> Open in CodeX Studio
        </a>
      </div>

      {/* Goal text */}
      {goal?.originalGoal && (
        <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border-color)', fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
          {goal.originalGoal}
        </div>
      )}

      {/* Runtime details */}
      <div style={{ padding: '8px 16px', display: 'flex', gap: '16px', flexWrap: 'wrap', fontSize: '0.75rem', color: 'var(--text-tertiary)', borderBottom: '1px solid var(--border-color)' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <Terminal size={12} /> Tool: <span style={{ color: 'var(--text-primary)', fontFamily: 'monospace' }}>{action.tool || '—'}</span>
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px', minWidth: 0 }}>
          <FileCode size={12} /> File: <span style={{ color: 'var(--color-purple)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis' }}>{action.filePath || action.command || '—'}</span>
        </span>
        <span>Next: {action.nextAction}</span>
        {connection !== 'connected' && !isTerminal && (
          <button
            onClick={() => setStreamNonce(n => n + 1)}
            style={{ background: 'none', border: 'none', color: 'var(--color-warning)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem', padding: 0 }}
          >
            <Loader2 size={12} className={connection === 'reconnecting' ? 'animate-spin' : ''} />
            {connection === 'reconnecting' ? 'Reconnecting stream…' : 'Stream disconnected — click to reconnect'}
          </button>
        )}
      </div>

      {/* Plan awaiting approval */}
      {needsApproval && latestPlan && (
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-color)' }}>
          <div style={{ fontSize: '0.6875rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-tertiary)', marginBottom: '6px' }}>
            Proposed plan — review before approving
          </div>
          <pre style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--text-primary)', whiteSpace: 'pre-wrap', fontFamily: 'inherit', maxHeight: '200px', overflowY: 'auto' }}>
            {latestPlan}
          </pre>
        </div>
      )}

      {/* Recent events */}
      {recentEvents.length > 0 && (
        <div ref={listRef} style={{ padding: '10px 16px', maxHeight: '140px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px', borderBottom: needsApproval ? 'none' : '1px solid var(--border-color)' }}>
          {recentEvents.map((evt, i) => (
            <div key={evt.sequence ?? i} style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'flex', gap: '8px' }}>
              <span style={{ color: statusColor, fontWeight: 600, flexShrink: 0 }}>[{evt.state}]</span>
              {evt.tool && <span style={{ color: 'var(--color-jarvis)', flexShrink: 0 }}>{evt.tool}</span>}
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{evt.userMessage || evt.message}</span>
            </div>
          ))}
        </div>
      )}

      {actionError && (
        <div style={{ padding: '8px 16px', fontSize: '0.8125rem', color: 'var(--color-error)', borderTop: '1px solid var(--border-color)' }}>
          {actionError}
        </div>
      )}

      {/* Approval controls */}
      {needsApproval && (
        <div style={{ padding: '12px 16px', display: 'flex', gap: '8px', justifyContent: 'flex-end', background: 'rgba(0,0,0,0.2)' }}>
          <button
            className={styles.actionBtn}
            onClick={() => sendApproval('abort')}
            disabled={!!busy}
            style={{ color: 'var(--color-error)', opacity: busy ? 0.5 : 1 }}
          >
            <XCircle size={14} /> Cancel Goal
          </button>
          <button
            className={`${styles.actionBtn} ${styles.primary}`}
            onClick={() => sendApproval('resume')}
            disabled={!!busy}
            style={{ background: 'var(--color-jarvis)', borderColor: 'var(--color-jarvis)', color: '#000', opacity: busy ? 0.5 : 1 }}
          >
            {busy === 'approve' ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
            Approve and Start
          </button>
        </div>
      )}
    </div>
  );
};
