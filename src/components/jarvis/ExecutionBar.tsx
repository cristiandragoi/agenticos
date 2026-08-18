/**
 * Live Execution Bar (coherence milestone) — renders the ONE canonical
 * execution record. Hidden when there is no active operation. Shows the
 * worker, status, LLM provider/model (resolved), current action, elapsed,
 * last-activity heartbeat, queue position, and a STOP that cancels the exact
 * operation via the backend.
 */
import React, { useEffect, useState } from 'react';
import { executionStore } from '../../diagnostics/executionStore';

const ACTIVE_STATUSES = new Set([
  'ROUTING', 'PLANNING', 'QUEUED', 'DISPATCHING', 'WAITING_FOR_MODEL', 'RUNNING',
  'TOOL_EXECUTION', 'WAITING_FOR_APPROVAL', 'WAITING_FOR_USER', 'COMPLETING', 'STOPPING',
]);

const STATUS_LABEL: Record<string, string> = {
  ROUTING: 'ROUTING', PLANNING: 'PLANNING', QUEUED: 'QUEUED', DISPATCHING: 'DISPATCHING',
  WAITING_FOR_MODEL: 'WAITING FOR MODEL', RUNNING: 'RUNNING', TOOL_EXECUTION: 'EXECUTING TOOL',
  WAITING_FOR_APPROVAL: 'AWAITING APPROVAL', WAITING_FOR_USER: 'WAITING FOR YOU', COMPLETING: 'COMPLETING', STOPPING: 'STOPPING',
  COMPLETED: 'COMPLETED', FAILED: 'FAILED', CANCELLED: 'CANCELLED',
};

export const ExecutionBar: React.FC = () => {
  const [exec, setExec] = useState(executionStore.get().current);
  const [, setTick] = useState(0);

  useEffect(() => {
    const unsub = executionStore.subscribe(() => {
      setExec(executionStore.get().current);
      setTick((t) => t + 1);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!exec || !ACTIVE_STATUSES.has(exec.status)) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [exec?.status, exec?.operationId]);

  if (!exec || !ACTIVE_STATUSES.has(exec.status)) return null;

  const elapsedS = Math.max(0, Math.round((Date.now() - exec.startedAt) / 1000));
  const idleS = Math.max(0, Math.round((Date.now() - exec.lastActivityAt) / 1000));
  const stalled = idleS > 30;
  // WAITING_FOR_USER: nothing is executing — no STOP, no worker, no LLM,
  // no spinner. The bar shows "Waiting for your reply" (conversation-state
  // milestone).
  const waitingForUser = exec.status === 'WAITING_FOR_USER';
  const canStop = !waitingForUser && exec.status !== 'COMPLETING' && exec.status !== 'STOPPING';

  const llm = waitingForUser
    ? null
    : exec.resolvedProvider || exec.requestedProvider
      ? `${exec.resolvedProvider || exec.requestedProvider}${(exec.resolvedModel || exec.requestedModel) ? ` / ${exec.resolvedModel || exec.requestedModel}` : ''}`
      : null;

  if (waitingForUser) {
    return (
      <div
        data-testid="execution-bar"
        data-state="waiting-for-user"
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          background: 'rgba(30,41,59,0.95)', border: '1px solid #334155',
          borderRadius: 10, padding: '6px 12px', margin: '4px 0',
          fontSize: 12, color: '#e2e8f0', position: 'sticky', bottom: 0, zIndex: 30,
        }}
      >
        <span data-testid="execution-waiting-dot" style={{ color: '#fbbf24', fontSize: 11 }}>●</span>
        <span style={{ fontWeight: 700, color: '#fbbf24' }}>Waiting for your reply</span>
        <span style={{ color: '#94a3b8' }}>· Clarification required</span>
        <span style={{ color: '#64748b', fontVariantNumeric: 'tabular-nums' }}>Waiting: {elapsedS}s</span>
        <span style={{ color: '#475569', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          Operation: {exec.operationId.slice(-14)}
        </span>
      </div>
    );
  }

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
          onClick={() => { executionStore.stop(); setTick((t) => t + 1); }}
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
      <span style={{ fontWeight: 700, color: '#93c5fd' }}>
        {exec.worker === 'jarvis' ? 'Jarvis' : exec.worker === 'codex' ? 'CodeX' : exec.worker === 'hermes' ? 'Hermes' : exec.worker === 'revenue' ? 'Revenue' : exec.worker}
      </span>
      <span style={{ fontWeight: 700, color: exec.status === 'STOPPING' ? '#f87171' : exec.status === 'WAITING_FOR_MODEL' ? '#f59e0b' : '#7dd3fc' }}>
        {STATUS_LABEL[exec.status] || exec.status}
      </span>
      {llm && (
        <span title="Resolved LLM provider/model (from the routing ledger)" style={{ background: '#1e293b', borderRadius: 6, padding: '1px 8px', color: '#94a3b8' }}>
          LLM: {llm}
        </span>
      )}
      {/* §8: workspace visibility — file/repository tasks show the canonical
          repository root so path failures are debuggable at a glance. */}
      {exec.workspace && exec.worker !== 'jarvis' && (
        <span
          data-testid="execution-workspace"
          title={`Canonical workspace root: ${exec.workspace}`}
          style={{ background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 6, padding: '1px 8px', color: '#67e8f9', fontSize: 10, fontFamily: 'monospace', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          {exec.workspace}
        </span>
      )}
      {exec.status === 'QUEUED' && exec.limit != null && (
        <span style={{ color: '#fbbf24' }}>
          {exec.currentAction ? '' : ''}Active {exec.activeCount ?? 0}/{exec.limit}
          {exec.queuePosition != null ? ` · Position ${exec.queuePosition}` : ''}
        </span>
      )}
      <span style={{ color: '#cbd5e1', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={exec.currentAction || ''}>
        {exec.currentAction || 'Working…'}
      </span>
      {exec.worker === 'revenue' && exec.targetCount != null && (
        <span data-testid="execution-revenue-counts" style={{ color: '#a5b4fc', fontSize: 11, whiteSpace: 'nowrap' }}>
          Target {exec.targetCount} · Discovered {exec.discoveredCount ?? '?'} · Qualified {exec.qualifiedCount ?? '?'} · Rejected {exec.rejectedCount ?? '?'}
        </span>
      )}
      <span style={{ color: '#64748b', fontVariantNumeric: 'tabular-nums' }}>{elapsedS}s</span>
      <span style={{ color: stalled ? '#f87171' : idleS > 5 ? '#f59e0b' : '#475569', fontSize: 11 }}>
        {stalled ? `Possible stall · last backend activity ${idleS}s ago` : `Last activity ${idleS}s ago`}
      </span>
      <span style={{ color: '#475569', fontSize: 10, fontVariantNumeric: 'tabular-nums' }} title="operationId">
        {exec.operationId.slice(-14)}
      </span>
    </div>
  );
};
