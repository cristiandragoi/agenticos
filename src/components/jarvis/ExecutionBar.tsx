/**
 * Live Execution Bar (PRIORITY 4/5/6) — persistent, near the chat input.
 * Shows the active agent, provider/model, current action, elapsed time,
 * last-activity heartbeat, and a STOP button that propagates cancellation.
 */
import React, { useEffect, useState } from 'react';
import { executionStore } from '../../diagnostics/executionStore';

const STOP_STATES = new Set(['queued', 'dispatching', 'planning', 'waiting', 'running', 'tool', 'retrying', 'thinking', 'understanding', 'streaming', 'working', 'investigating']);

export const ExecutionBar: React.FC = () => {
  const [exec, setExec] = useState(executionStore.get());
  const [, setTick] = useState(0);

  useEffect(() => {
    const unsub = executionStore.subscribe(() => {
      setExec(executionStore.get());
      setTick((t) => t + 1);
    });
    return unsub;
  }, []);

  // Elapsed + last-activity heartbeat (1s tick while active).
  useEffect(() => {
    if (!exec.active) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [exec.active]);

  if (!exec.active) return null;

  const elapsedS = Math.max(0, Math.round((Date.now() - exec.startedAt) / 1000));
  const idleS = Math.max(0, Math.round((Date.now() - exec.lastActivityAt) / 1000));
  const canStop = STOP_STATES.has(exec.state || '');

  const onStop = () => {
    if (executionStore.stop()) setTick((t) => t + 1);
  };

  return (
    <div
      data-testid="execution-bar"
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        background: 'rgba(15,23,42,0.95)', border: '1px solid #1e293b',
        borderRadius: 10, padding: '6px 12px', margin: '4px 0',
        fontSize: 12, color: '#e2e8f0', position: 'sticky', bottom: 0, zIndex: 30,
      }}
    >
      {canStop ? (
        <button
          data-testid="execution-stop"
          onClick={onStop}
          style={{
            background: '#dc2626', color: '#fff', border: 'none', borderRadius: 6,
            padding: '4px 10px', fontWeight: 700, cursor: 'pointer', fontSize: 11,
          }}
        >
          ■ STOP
        </button>
      ) : (
        <span style={{ color: '#64748b', fontSize: 11 }}>■</span>
      )}
      <span style={{ fontWeight: 700, color: '#93c5fd' }}>{exec.agent || 'Jarvis'}</span>
      {exec.provider && (
        <span style={{ background: '#1e293b', borderRadius: 6, padding: '1px 8px', color: '#94a3b8' }}>
          {exec.provider}{exec.model ? ` / ${exec.model}` : ''}
        </span>
      )}
      <span style={{ color: '#cbd5e1', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {exec.currentAction || exec.stage || 'Working…'}
      </span>
      <span style={{ color: '#64748b', fontVariantNumeric: 'tabular-nums' }}>{elapsedS}s</span>
      <span style={{ color: idleS > 5 ? '#f59e0b' : '#475569', fontSize: 11 }}>
        Last activity {idleS}s ago
      </span>
    </div>
  );
};
