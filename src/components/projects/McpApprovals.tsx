import React, { useEffect, useState, useCallback } from 'react';
import { ShieldCheck, ShieldX, Clock } from 'lucide-react';
import { apiFetch } from '../../api/client';

interface PendingApproval {
  id: string;
  taskId: string;
  projectId: string;
  worker: string;
  taskType: string;
  title: string;
  prompt: string;
  risk: string;
  expiresAt: string;
  createdAt: string;
}

/**
 * Minimal MCP bridge approvals widget (Phase 1, §8).
 *
 * Lists prepared MCP tasks awaiting approval and lets the human approve or
 * reject through the authoritative backend endpoints. Smallest functional
 * extension to the existing approval surface — no redesign.
 */
export function McpApprovals({ refreshKey }: { refreshKey?: number }) {
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch('/api/mcp-bridge/approvals');
      const data = await res.json();
      setApprovals(Array.isArray(data.approvals) ? data.approvals : []);
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'Failed to load approvals');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const decide = async (taskId: string, approved: boolean) => {
    setBusy(taskId);
    setError(null);
    try {
      await apiFetch(`/api/mcp-bridge/tasks/${taskId}/${approved ? 'approve' : 'reject'}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ responder: 'user' }),
      });
      await load();
    } catch (e: any) {
      setError(e?.message || `Failed to ${approved ? 'approve' : 'reject'} task`);
    } finally {
      setBusy(null);
    }
  };

  if (approvals.length === 0 && !error) return null;

  return (
    <div style={{ border: '1px solid #1e293b', borderRadius: 8, padding: 10, marginBottom: 12, background: '#0b1220' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <Clock size={14} color="#fbbf24" />
        <span style={{ fontSize: 12, fontWeight: 700, color: '#fbbf24', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Pending MCP approvals
        </span>
      </div>
      {error && <div style={{ color: '#f87171', fontSize: 12, marginBottom: 8 }}>{error}</div>}
      {approvals.map((a) => (
        <div key={a.id} style={{ borderTop: '1px solid #1e293b', padding: '8px 0', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>{a.title}</div>
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
              {a.worker} · {a.taskType} · risk <span style={{ color: a.risk === 'CONSEQUENTIAL' ? '#f87171' : '#fbbf24' }}>{a.risk}</span>
              {' · '}expires {new Date(a.expiresAt).toLocaleString()}
            </div>
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {a.prompt.slice(0, 180)}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            <button
              type="button"
              disabled={busy === a.taskId}
              onClick={() => decide(a.taskId, true)}
              title="Approve"
              style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(16,185,129,0.12)', color: '#34d399', border: '1px solid #065f46', borderRadius: 6, padding: '5px 10px', fontSize: 11, cursor: 'pointer' }}
            >
              <ShieldCheck size={12} /> Approve
            </button>
            <button
              type="button"
              disabled={busy === a.taskId}
              onClick={() => decide(a.taskId, false)}
              title="Reject"
              style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(239,68,68,0.12)', color: '#f87171', border: '1px solid #7f1d1d', borderRadius: 6, padding: '5px 10px', fontSize: 11, cursor: 'pointer' }}
            >
              <ShieldX size={12} /> Reject
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
