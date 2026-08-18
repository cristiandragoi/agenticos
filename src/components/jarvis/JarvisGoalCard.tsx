import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { ExternalLink, CheckCircle2, XCircle, Loader2, Terminal, FileCode, Copy, Check, AlertTriangle } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
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

const CopyButton = ({ text, label }: { text: string; label: string }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };

  return (
    <button 
      onClick={handleCopy} 
      className={styles.actionBtn}
      style={{ 
        padding: '3px 8px', 
        fontSize: '0.75rem', 
        display: 'flex', 
        alignItems: 'center', 
        gap: '4px', 
        flexShrink: 0,
        cursor: 'pointer'
      }}
      aria-label={label}
      title={label}
    >
      {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
      <span>{copied ? 'Copied' : 'Copy Result'}</span>
    </button>
  );
};

const MarkdownComponents = {
  pre({ children, ...props }: any) {
    const codeElement = children as React.ReactElement<any>;
    const codeText = codeElement?.props?.children || '';
    return (
      <div style={{ position: 'relative', marginTop: '8px', marginBottom: '8px' }}>
        <div style={{ position: 'absolute', top: '6px', right: '6px', zIndex: 10 }}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              navigator.clipboard.writeText(String(codeText).replace(/\n$/, ''));
            }}
            style={{
              padding: '2px 6px',
              fontSize: '10px',
              backgroundColor: 'rgba(30, 41, 59, 0.8)',
              border: '1px solid rgba(148, 163, 184, 0.2)',
              borderRadius: '4px',
              color: '#94a3b8',
              cursor: 'pointer'
            }}
            title="Copy code"
          >
            Copy
          </button>
        </div>
        <pre style={{ backgroundColor: '#090C10', padding: '24px 12px 12px', borderRadius: '6px', overflowX: 'auto', margin: 0, border: '1px solid rgba(148, 163, 184, 0.15)', fontSize: '0.8125rem', fontFamily: '"JetBrains Mono", monospace', color: '#cbd5e1' }} {...props}>
          {children}
        </pre>
      </div>
    );
  },
  code({ className, children, ...props }: any) {
    return <code className={className} {...props} style={{ backgroundColor: '#090C10', padding: '2px 4px', borderRadius: '4px', fontFamily: '"JetBrains Mono", monospace', fontSize: '0.8125rem', color: '#c084fc', border: '1px solid rgba(148, 163, 184, 0.1)' }}>{children}</code>;
  },
  h1({ children, ...props }: any) {
    return <h1 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '12px', marginBottom: '6px', borderBottom: '1px solid var(--border-color)', paddingBottom: '4px' }} {...props}>{children}</h1>;
  },
  h2({ children, ...props }: any) {
    return <h2 style={{ fontSize: '0.9375rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '10px', marginBottom: '4px' }} {...props}>{children}</h2>;
  },
  h3({ children, ...props }: any) {
    return <h3 style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-jarvis)', marginTop: '8px', marginBottom: '4px' }} {...props}>{children}</h3>;
  },
  p({ children, ...props }: any) {
    return <p style={{ margin: '0 0 8px 0', lineHeight: 1.6, color: 'var(--text-secondary)' }} {...props}>{children}</p>;
  },
  ul({ children, ...props }: any) {
    return <ul style={{ margin: '0 0 8px 0', paddingLeft: '20px', color: 'var(--text-secondary)', lineHeight: 1.5 }} {...props}>{children}</ul>;
  },
  ol({ children, ...props }: any) {
    return <ol style={{ margin: '0 0 8px 0', paddingLeft: '20px', color: 'var(--text-secondary)', lineHeight: 1.5 }} {...props}>{children}</ol>;
  },
  li({ children, ...props }: any) {
    return <li style={{ marginBottom: '3px' }} {...props}>{children}</li>;
  }
};

interface JarvisGoalCardProps {
  goalId: string;
}

/**
 * Compact CodeX execution card for the Jarvis conversation.
 * Subscribes to the real goal event stream using the exact goalId returned
 * at creation, shows live status/current action, wires approval controls,
 * and renders the complete, formatted final answer upon task completion.
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

  const fetchGoal = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/chat/agents/goal/${goalId}`);
      if (!res.ok) throw new Error(`Goal lookup failed (${res.status})`);
      const data = await res.json();
      setGoal(data);
      setGoalStatus(data.status);
      if (data.history && Array.isArray(data.history) && data.history.length > 0) {
        setEvents(data.history);
      }
      if (data.status && TERMINAL_GOAL_STATES.includes(String(data.status).toLowerCase())) {
        window.dispatchEvent(new CustomEvent('jarvis:goal-terminal', { detail: { goalId, status: data.status } }));
      }
    } catch (err: any) {
      setActionError(err.message);
    }
  }, [goalId]);

  // Initial goal snapshot (covers reloads before any live event arrives).
  useEffect(() => {
    void fetchGoal();
  }, [fetchGoal]);

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
          window.dispatchEvent(new CustomEvent('jarvis:goal-terminal', { detail: { goalId, status: data.state } }));
          void fetchGoal(); // Refresh snapshot for canonical runSummary
          es.close();
        }
      } catch (err) {}
    });

    es.onerror = () => {
      setConnection(es.readyState === EventSource.CLOSED ? 'disconnected' : 'reconnecting');
      void fetchGoal();
    };

    return () => es.close();
  }, [goalId, streamNonce, fetchGoal]);

  const normalizedEvents = useMemo(() => events.map(normalizeExecutionEvent), [events]);
  const action = useMemo(
    () => deriveCurrentAction(goalStatus, normalizedEvents, connection),
    [goalStatus, normalizedEvents, connection]
  );

  const status = (goalStatus || '').toLowerCase();
  const isTerminal = TERMINAL_GOAL_STATES.includes(status);
  const isCompleted = status === 'completed';
  const isFailed = status === 'failed' || status === 'timed_out';
  const isStopped = status === 'stopped' || status === 'cancelled';

  // Ensure terminal state always synchronizes Jarvis runtime state to idle
  useEffect(() => {
    if (isTerminal && goalStatus) {
      window.dispatchEvent(new CustomEvent('jarvis:goal-terminal', { detail: { goalId, status: goalStatus } }));
    }
  }, [goalId, goalStatus, isTerminal]);

  // Canonical resolution of final answer text (Priority order: terminal event payload -> runSummary -> goal.finalAnswer)
  const finalAnswer = useMemo(() => {
    if (!isCompleted) return null;

    const finishEvent = [...events].reverse().find(e => 
      e.eventType === 'agent_completed' || 
      e.eventType === 'task_completed' || 
      e.state === 'completed' || 
      e.tool === 'finish' ||
      e.payload?.finalAnswer
    );
    if (finishEvent?.payload?.finalAnswer && typeof finishEvent.payload.finalAnswer === 'string' && finishEvent.payload.finalAnswer.trim()) {
      return finishEvent.payload.finalAnswer.trim();
    }
    if (finishEvent?.message && typeof finishEvent.message === 'string' && finishEvent.message.startsWith('Goal finished:')) {
      return finishEvent.message.replace(/^Goal finished:\s*/i, '').trim();
    }

    if (goal?.runSummary?.finalAnswer && typeof goal.runSummary.finalAnswer === 'string' && goal.runSummary.finalAnswer.trim()) {
      return goal.runSummary.finalAnswer.trim();
    }
    if (goal?.runSummary?.message && typeof goal.runSummary.message === 'string' && goal.runSummary.message.startsWith('Goal finished:')) {
      return goal.runSummary.message.replace(/^Goal finished:\s*/i, '').trim();
    }
    if (goal?.finalAnswer && typeof goal.finalAnswer === 'string' && goal.finalAnswer.trim()) {
      return goal.finalAnswer.trim();
    }

    return null;
  }, [events, goal, isCompleted]);

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
  const needsApproval = status === 'waiting_for_approval';

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
        background: isCompleted ? 'rgba(56, 189, 248, 0.08)' : isFailed ? 'rgba(248, 113, 113, 0.08)' : 'rgba(56, 189, 248, 0.04)'
      }}>
        <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: statusColor, boxShadow: `0 0 8px ${statusColor}`, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 600, color: 'var(--text-primary)' }}>
            CodeX Task <span style={{ fontFamily: 'monospace', fontSize: '0.8125rem', color: 'var(--text-tertiary)' }}>{goalId}</span>
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
          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Task: </span>
          {goal.originalGoal}
        </div>
      )}

      {/* Final Result Container (Completed) */}
      {isCompleted && (
        <div data-testid="jarvis-goal-final-result" style={{ padding: '14px 16px', borderBottom: '1px solid var(--border-color)', background: 'rgba(15, 23, 42, 0.6)' }}>
          {finalAnswer ? (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px', paddingBottom: '6px', borderBottom: '1px solid rgba(148, 163, 184, 0.2)' }}>
                <span style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-jarvis)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <CheckCircle2 size={14} /> CodeX Result
                </span>
                <CopyButton text={finalAnswer} label="Copy Result" />
              </div>
              <div style={{ maxHeight: '420px', overflowY: 'auto', fontSize: '0.875rem' }}>
                <ReactMarkdown components={MarkdownComponents}>
                  {finalAnswer}
                </ReactMarkdown>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--color-warning)', fontSize: '0.8125rem' }}>
              <AlertTriangle size={14} />
              <span>CodeX completed the execution but no final result was returned.</span>
            </div>
          )}
        </div>
      )}

      {/* Failure State */}
      {isFailed && (
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-color)', background: 'rgba(239, 68, 68, 0.06)', color: 'var(--color-error)', fontSize: '0.8125rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600, marginBottom: '4px' }}>
            <XCircle size={14} /> Execution Failed
          </div>
          <p style={{ margin: 0, opacity: 0.9 }}>
            {actionError || action.error || 'The task failed during execution. Check CodeX Studio or server logs for details.'}
          </p>
        </div>
      )}

      {/* Stopped State */}
      {isStopped && (
        <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border-color)', color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>
          Execution stopped by user.
        </div>
      )}

      {/* Runtime details (when in-flight or inspecting) */}
      {!isTerminal && (
        <div style={{ padding: '8px 16px', display: 'flex', gap: '16px', flexWrap: 'wrap', fontSize: '0.75rem', color: 'var(--text-tertiary)', borderBottom: '1px solid var(--border-color)' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Terminal size={12} /> Tool: <span style={{ color: 'var(--text-primary)', fontFamily: 'monospace' }}>{action.tool || '—'}</span>
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px', minWidth: 0 }}>
            <FileCode size={12} /> File: <span style={{ color: 'var(--color-purple)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis' }}>{action.filePath || action.command || '—'}</span>
          </span>
          <span>Next: {action.nextAction}</span>
          {connection !== 'connected' && (
            <button
              onClick={() => setStreamNonce(n => n + 1)}
              style={{ background: 'none', border: 'none', color: 'var(--color-warning)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem', padding: 0 }}
            >
              <Loader2 size={12} className={connection === 'reconnecting' ? 'animate-spin' : ''} />
              {connection === 'reconnecting' ? 'Reconnecting stream…' : 'Stream disconnected — click to reconnect'}
            </button>
          )}
        </div>
      )}

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

      {/* Recent events (in-flight only) */}
      {!isTerminal && recentEvents.length > 0 && (
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

      {/* Goal execution & approval controls */}
      {(!isTerminal || needsApproval) && (
        <div style={{ padding: '8px 16px', display: 'flex', gap: '8px', justifyContent: 'flex-end', background: 'rgba(0,0,0,0.2)' }}>
          <button
            className={styles.actionBtn}
            onClick={() => sendApproval('abort')}
            disabled={!!busy}
            style={{ color: 'var(--color-error)', opacity: busy ? 0.5 : 1 }}
            data-testid="jarvis-cancel-goal-btn"
            aria-label="Cancel Goal"
            title="Cancel Goal"
          >
            <XCircle size={14} /> Cancel Goal
          </button>
          {needsApproval && (
            <button
              className={`${styles.actionBtn} ${styles.primary}`}
              onClick={() => sendApproval('resume')}
              disabled={!!busy}
              style={{ background: 'var(--color-jarvis)', borderColor: 'var(--color-jarvis)', color: '#000', opacity: busy ? 0.5 : 1 }}
            >
              {busy === 'approve' ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
              Approve and Start
            </button>
          )}
        </div>
      )}
    </div>
  );
};
