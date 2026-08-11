// Project Live Work — detailed per-project execution timeline.
// Uses REAL operational events (background_task_events via /api/jarvis/live-events?projectId=).
// Filters: by task, by agent; ordering by timestamp; completed/history distinction.
// Never shows raw LLM tokens (server excludes streaming progress events).
import React, { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../api/client';

interface LiveEvent {
  id: string; taskId?: string; ts?: string; kind: string; summary?: string;
  detail?: Record<string, any>; taskTitle?: string; taskWorker?: string;
}

const KIND_COLOR: Record<string, string> = {
  'task.started': '#00d4ff', 'task.created': '#0891b2', 'task.completed': '#22c55e',
  'task.failed': '#ef4444', 'task.blocked': '#f59e0b', 'task.file_changed': '#a855f7',
  'task.build_started': '#f5b50a', 'task.build_completed': '#22c55e',
  'task.test_started': '#f5b50a', 'task.test_completed': '#22c55e',
  'task.approval_requested': '#f59e0b', 'task.cancelled': '#64748b',
  'task.progress': '#94a3b8', 'task.agent_selected': '#ec4899',
  'task.run_linked': '#67e8f9', 'task.board_linked': '#67e8f9',
  'task.delegated': '#ec4899', 'task.review_started': '#a855f7', 'task.verified': '#22c55e',
};

export const ProjectLiveWork: React.FC<{ projectId: string }> = ({ projectId }) => {
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [taskFilter, setTaskFilter] = useState('');
  const [agentFilter, setAgentFilter] = useState('');
  const [showHistory, setShowHistory] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/jarvis/live-events?projectId=${encodeURIComponent(projectId)}&limit=60`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) setEvents(data);
      }
    } catch { /* best effort */ }
    setLoading(false);
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const agents = [...new Set(events.map((e) => e.taskWorker).filter(Boolean))];
  const taskIds = [...new Set(events.map((e) => e.taskId).filter(Boolean))];

  const TERMINAL_KINDS = new Set(['task.completed', 'task.failed', 'task.cancelled']);
  const filtered = events
    .filter((e) => !taskFilter || e.taskId === taskFilter)
    .filter((e) => !agentFilter || e.taskWorker === agentFilter)
    .filter((e) => (showHistory ? true : !TERMINAL_KINDS.has(e.kind)));

  return (
    <div data-testid="project-livework">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#475569', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
          Live Work — {filtered.length} event{filtered.length !== 1 ? 's' : ''}
        </span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={taskFilter} onChange={(e) => setTaskFilter(e.target.value)} style={selStyle}>
            <option value="">All tasks</option>
            {taskIds.map((id) => <option key={id} value={id}>{String(id).slice(-8)}</option>)}
          </select>
          <select value={agentFilter} onChange={(e) => setAgentFilter(e.target.value)} style={selStyle}>
            <option value="">All agents</option>
            {agents.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <label style={{ fontSize: 11, color: '#64748b', display: 'flex', alignItems: 'center', gap: 4 }}>
            <input type="checkbox" checked={showHistory} onChange={(e) => setShowHistory(e.target.checked)} />
            Show history
          </label>
          <button type="button" onClick={() => void load()} style={{ background: '#1e293b', color: '#94a3b8', border: '1px solid #334155', borderRadius: 6, padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}>
            Refresh
          </button>
        </div>
      </div>
      {loading && <div style={{ fontSize: 12, color: '#475569' }}>Loading…</div>}
      {!loading && filtered.length === 0 && (
        <div style={{ fontSize: 12, color: '#334155', padding: '18px 0', textAlign: 'center' }}>
          No operational events for this project yet. Create and start a task to see live activity.
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 420, overflowY: 'auto' }}>
        {filtered.map((e) => (
          <div key={e.id || `${e.ts}-${e.kind}`} data-testid={`livework-event-${e.kind}`} style={{
            display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 10px',
            borderRadius: 6, background: 'rgba(15,23,42,0.5)', border: '1px solid rgba(30,58,95,0.3)',
            fontSize: 11,
          }}>
            <span style={{
              flex: '0 0 auto', fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
              color: KIND_COLOR[e.kind] || '#94a3b8', background: 'rgba(15,23,42,0.7)',
              padding: '1px 6px', borderRadius: 8,
            }}>
              {String(e.kind).replace('task.', '')}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: '#cbd5e1', wordBreak: 'break-word' }}>{e.summary || (e.detail && (e.detail.message || e.detail.error)) || e.kind}</div>
              {(e.taskTitle || e.taskWorker) && (
                <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>
                  {e.taskTitle && <span>{e.taskTitle.slice(0, 60)}</span>}
                  {e.taskWorker && <span> · {e.taskWorker}</span>}
                  {e.ts && <span> · {new Date(e.ts).toLocaleTimeString()}</span>}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const selStyle: React.CSSProperties = {
  background: '#0f172a', color: '#94a3b8', border: '1px solid #334155', borderRadius: 6,
  fontSize: 11, padding: '4px 8px',
};

export default ProjectLiveWork;
